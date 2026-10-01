import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { Db, DbOrTx } from '@/db/client';
import {
  bookingItems,
  bookingOperatorRequests,
  bookings,
  bookingStatusEvents,
  menuOperators,
  menus,
  menuTranslations,
  operators,
  shops,
  slots,
  user,
} from '@/db/schema';
import { writeAuditLog } from '@/modules/audit/log';
import { BookingError } from '@/modules/booking/errors';
import { isOpenRequest, type BookingStatus } from '@/modules/booking/status';
import { resolveSettings } from '@/modules/shop/settings';

export type RequestStatus = (typeof bookingOperatorRequests.$inferSelect)['status'];

/** 事業者が回答し直せる予約の状態（組合が支払案内へ進める前） */
export function canReanswer(status: BookingStatus): boolean {
  return status === 'requested' || status === 'reviewing' || status === 'operator_checking';
}
export type OperatorResponse = 'accepted' | 'declined' | 'conditional';

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  pending: '回答待ち',
  accepted: '受入可',
  declined: '受入不可',
  conditional: '条件付きで可',
  withdrawn: '取り下げ',
};

/** プランの実施候補の事業者（停止中の事業者は除く）。候補がなければプランの事業者（初期値） */
export async function listMenuCandidates(
  db: DbOrTx,
  params: { shopId: string; menuId: string; includeSuspended?: boolean },
) {
  const rows = await db
    .select({ id: operators.id, name: operators.name, email: operators.email, status: operators.status })
    .from(menuOperators)
    .innerJoin(operators, eq(operators.id, menuOperators.operatorId))
    .where(and(eq(menuOperators.menuId, params.menuId), eq(operators.shopId, params.shopId)))
    .orderBy(asc(menuOperators.sortOrder), asc(operators.name));
  // プランの編集では停止中の候補も出す（停止を解除すれば、また照会に出る）
  return params.includeSuspended ? rows : rows.filter((r) => r.status !== 'suspended');
}

/**
 * プランの実施候補を置き換える（並び順は渡した順。別ショップの事業者は無視する）。
 * 停止中の事業者は、今の候補に入っているときだけ残せる（新しく候補には入れない）。
 * 候補を設定したときは、予約の初期値の事業者も候補に入れる（初期値の事業者に照会できないことがないように）
 */
export async function setMenuCandidates(
  db: DbOrTx,
  params: { shopId: string; menuId: string; operatorIds: string[] },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [menu] = await tx
      .select({ id: menus.id, operatorId: menus.operatorId })
      .from(menus)
      .where(and(eq(menus.id, params.menuId), eq(menus.shopId, params.shopId)));
    if (!menu) throw new BookingError('SLOT_NOT_FOUND');
    const requested = params.operatorIds.filter((id, i, all) => all.indexOf(id) === i);
    const valid = requested.length
      ? await tx
          .select({ id: operators.id, status: operators.status })
          .from(operators)
          .where(and(eq(operators.shopId, params.shopId), inArray(operators.id, requested)))
      : [];
    const current = new Set(
      (
        await tx
          .select({ operatorId: menuOperators.operatorId })
          .from(menuOperators)
          .where(eq(menuOperators.menuId, menu.id))
      ).map((r) => r.operatorId),
    );
    const ids = requested.filter((id) =>
      valid.some((v) => v.id === id && (v.status !== 'suspended' || current.has(id))),
    );
    if (ids.length > 0 && menu.operatorId && !ids.includes(menu.operatorId)) {
      const [initial] = await tx
        .select({ status: operators.status })
        .from(operators)
        .where(eq(operators.id, menu.operatorId));
      if (initial && initial.status !== 'suspended') ids.unshift(menu.operatorId);
    }
    await tx.delete(menuOperators).where(eq(menuOperators.menuId, menu.id));
    if (ids.length > 0) {
      await tx
        .insert(menuOperators)
        .values(ids.map((operatorId, i) => ({ menuId: menu.id, operatorId, sortOrder: i })));
    }
  });
}

/**
 * 事業者へ受入確認（照会）を依頼する。予約がまだ確定前（仮受付・内容確認中・事業者確認中）のときだけ。
 * 仮受付・内容確認中なら「事業者確認中」へ進め、履歴を残す。同じ事業者へ照会し直すと回答待ちに戻す
 */
export async function requestOperatorAcceptance(
  db: Db,
  input: {
    shopId: string;
    bookingId: string;
    operatorIds: string[];
    note: string;
    actorId: string | null;
    now: Date;
    /** system：申込を受けて自動で依頼したとき（履歴に「自動」と残す） */
    actorType?: 'staff' | 'system';
  },
): Promise<{ requestIds: string[] }> {
  if (input.operatorIds.length === 0) throw new BookingError('OPERATOR_NOT_FOUND');
  return db.transaction(async (tx) => {
    const [booking] = await tx
      .select({ id: bookings.id, status: bookings.status })
      .from(bookings)
      .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)))
      .for('update');
    if (!booking) throw new BookingError('BOOKING_NOT_FOUND');
    if (!isOpenRequest(booking.status) || booking.status === 'awaiting_payment') {
      throw new BookingError('INVALID_TRANSITION');
    }
    const found = await tx
      .select({ id: operators.id, status: operators.status })
      .from(operators)
      .where(and(eq(operators.shopId, input.shopId), inArray(operators.id, input.operatorIds)));
    if (found.length !== new Set(input.operatorIds).size || found.some((o) => o.status === 'suspended')) {
      throw new BookingError('OPERATOR_NOT_FOUND');
    }
    const note = input.note.trim();
    const rows = await tx
      .insert(bookingOperatorRequests)
      .values(
        found.map((o) => ({
          bookingId: booking.id,
          operatorId: o.id,
          requestNote: note,
          requestedAt: sql`now()`,
          requestedBy: input.actorId,
        })),
      )
      .onConflictDoUpdate({
        target: [bookingOperatorRequests.bookingId, bookingOperatorRequests.operatorId],
        set: {
          status: 'pending',
          requestNote: note,
          responseNote: '',
          requestedAt: sql`now()`,
          requestedBy: input.actorId,
          respondedAt: null,
          respondedBy: null,
        },
      })
      .returning({ id: bookingOperatorRequests.id });
    if (booking.status !== 'operator_checking') {
      await tx.update(bookings).set({ status: 'operator_checking' }).where(eq(bookings.id, booking.id));
    }
    await tx.insert(bookingStatusEvents).values({
      bookingId: booking.id,
      fromStatus: booking.status,
      toStatus: 'operator_checking',
      actorType: input.actorType ?? 'staff',
      actorId: input.actorId,
      note:
        input.actorType === 'system'
          ? 'プランの事業者へ、自動で受入確認を依頼'
          : `事業者へ受入確認を依頼（${found.length} 社）${note ? `：${note}` : ''}`,
    });
    await writeAuditLog(tx, {
      shopId: input.shopId,
      actorId: input.actorId,
      action: 'booking.request_operator',
      targetType: 'booking',
      targetId: booking.id,
      after: { operatorIds: found.map((o) => o.id), note },
    });
    return { requestIds: rows.map((r) => r.id) };
  });
}

/**
 * Web の申込を受けたら、プランの掲載元の事業者へ自動で受入確認を送る（設定の autoRequestOwner が有効なとき）。
 * 事業者が決まっていない・停止中・仮受付でないときは何もしない。依頼した照会の id を返す（メールを送るため）
 */
export async function autoRequestPlanOperator(
  db: Db,
  params: { bookingId: string; now: Date },
): Promise<string | null> {
  const [row] = await db
    .select({
      shopId: bookings.shopId,
      status: bookings.status,
      operatorId: bookings.operatorId,
      operatorStatus: operators.status,
      settings: shops.settings,
    })
    .from(bookings)
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    .leftJoin(operators, eq(operators.id, bookings.operatorId))
    .where(eq(bookings.id, params.bookingId));
  if (!row?.operatorId || row.operatorStatus === 'suspended' || row.status !== 'requested') return null;
  if (!resolveSettings(row.settings).autoRequestOwner) return null;
  const { requestIds } = await requestOperatorAcceptance(db, {
    shopId: row.shopId,
    bookingId: params.bookingId,
    operatorIds: [row.operatorId],
    note: '',
    actorId: null,
    now: params.now,
    actorType: 'system',
  });
  return requestIds[0] ?? null;
}

/** 照会を取り下げる（別の事業者に決まったなど）。回答待ち・回答済みのどちらでも */
export async function withdrawRequest(
  db: Db,
  input: { shopId: string; requestId: string; actorId: string | null },
): Promise<void> {
  await db.transaction(async (tx) => {
    // 予約を先にロックする（状態の変更・事業者の回答と同じ順番）
    const [target] = await tx
      .select({ bookingId: bookingOperatorRequests.bookingId, operatorId: bookingOperatorRequests.operatorId })
      .from(bookingOperatorRequests)
      .innerJoin(bookings, eq(bookings.id, bookingOperatorRequests.bookingId))
      .where(and(eq(bookingOperatorRequests.id, input.requestId), eq(bookings.shopId, input.shopId)));
    if (!target) throw new BookingError('BOOKING_NOT_FOUND');
    const [booking] = await tx
      .select({ status: bookings.status, operatorId: bookings.operatorId })
      .from(bookings)
      .where(eq(bookings.id, target.bookingId))
      .for('update');
    // 取り下げられるのは確定前だけ。支払案内を送ったあとの実施事業者の照会は残す
    if (
      !booking ||
      !isOpenRequest(booking.status) ||
      (booking.status === 'awaiting_payment' && booking.operatorId === target.operatorId)
    ) {
      throw new BookingError('INVALID_TRANSITION');
    }
    const [row] = await tx
      .update(bookingOperatorRequests)
      .set({ status: 'withdrawn' })
      .where(
        and(eq(bookingOperatorRequests.id, input.requestId), sql`${bookingOperatorRequests.status} <> 'withdrawn'`),
      )
      .returning({ id: bookingOperatorRequests.id });
    if (!row) return;
    await writeAuditLog(tx, {
      shopId: input.shopId,
      actorId: input.actorId,
      action: 'booking.withdraw_operator_request',
      targetType: 'booking',
      targetId: target.bookingId,
      after: { requestId: input.requestId },
    });
  });
}

/**
 * 事業者が照会に回答する（自社への照会だけ）。回答待ちのほか、組合が支払案内へ進めるまでは回答し直せる。
 * 受入可のとき、組合が選んだ事業者・ほかの受入可の事業者に決まっていなければ、その事業者を割り当てる
 */
export async function respondToRequest(
  db: Db,
  input: {
    operatorId: string;
    requestId: string;
    response: OperatorResponse;
    note: string;
    actorId: string | null;
    now: Date;
  },
): Promise<{ bookingId: string; shopId: string; assigned: boolean }> {
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ bookingId: bookingOperatorRequests.bookingId })
      .from(bookingOperatorRequests)
      .where(
        and(eq(bookingOperatorRequests.id, input.requestId), eq(bookingOperatorRequests.operatorId, input.operatorId)),
      );
    if (!target) throw new BookingError('BOOKING_NOT_FOUND');
    // 照会の依頼と同じく、予約 → 照会の順にロックする（同時に操作しても待ち合いにならないように）
    const [booking] = await tx
      .select({
        id: bookings.id,
        shopId: bookings.shopId,
        status: bookings.status,
        operatorId: bookings.operatorId,
        operatorAssignedVia: bookings.operatorAssignedVia,
      })
      .from(bookings)
      .where(eq(bookings.id, target.bookingId))
      .for('update');
    const [request] = await tx
      .select()
      .from(bookingOperatorRequests)
      .where(eq(bookingOperatorRequests.id, input.requestId))
      .for('update');
    if (!booking || !isOpenRequest(booking.status) || request.status === 'withdrawn') {
      throw new BookingError('INVALID_TRANSITION');
    }
    // 回答し直せるのは、組合が支払案内へ進める前だけ（支払待ちでは、まだ回答していない照会だけ回答できる）
    if (request.status !== 'pending' && !canReanswer(booking.status)) throw new BookingError('INVALID_TRANSITION');
    const note = input.note.trim();
    await tx
      .update(bookingOperatorRequests)
      .set({ status: input.response, responseNote: note, respondedAt: sql`now()`, respondedBy: input.actorId })
      .where(eq(bookingOperatorRequests.id, request.id));
    // 実施事業者を自動で決めるのは「受入可」のときだけ（条件付きは組合がお客様と調整してから決める）。
    // 組合が選んだ事業者は置き換えない。ほかに受入可の事業者がいて、その事業者に決まっているときも置き換えない
    let assigned = false;
    // 支払案内のあと（支払待ち）は、回答で実施事業者を動かさない（組合が回答を見て、確定か担当の変更かを決める）
    const assignable = canReanswer(booking.status);
    if (
      assignable &&
      input.response === 'accepted' &&
      booking.operatorId !== input.operatorId &&
      booking.operatorAssignedVia !== 'staff'
    ) {
      const [current] = booking.operatorId
        ? await tx
            .select({ status: bookingOperatorRequests.status })
            .from(bookingOperatorRequests)
            .where(
              and(
                eq(bookingOperatorRequests.bookingId, booking.id),
                eq(bookingOperatorRequests.operatorId, booking.operatorId),
              ),
            )
        : [];
      if (current?.status !== 'accepted') {
        await tx
          .update(bookings)
          .set({ operatorId: input.operatorId, operatorAssignedVia: 'response' })
          .where(eq(bookings.id, booking.id));
        await writeAuditLog(tx, {
          shopId: booking.shopId,
          actorId: input.actorId,
          action: 'booking.assign_operator',
          targetType: 'booking',
          targetId: booking.id,
          before: { operatorId: booking.operatorId },
          after: { operatorId: input.operatorId, via: 'response' },
        });
        assigned = true;
      }
    }
    // 受入可で自動に決まった事業者が、回答を受入不可・条件付きに直したときは、割り当てを外す（組合が選び直す）
    if (
      assignable &&
      input.response !== 'accepted' &&
      booking.operatorId === input.operatorId &&
      booking.operatorAssignedVia === 'response'
    ) {
      await tx
        .update(bookings)
        .set({ operatorId: null, operatorAssignedVia: 'default' })
        .where(eq(bookings.id, booking.id));
      await writeAuditLog(tx, {
        shopId: booking.shopId,
        actorId: input.actorId,
        action: 'booking.assign_operator',
        targetType: 'booking',
        targetId: booking.id,
        before: { operatorId: booking.operatorId },
        after: { operatorId: null, via: 'response' },
      });
    }
    await tx.insert(bookingStatusEvents).values({
      bookingId: booking.id,
      fromStatus: booking.status,
      toStatus: booking.status,
      actorType: 'operator',
      actorId: input.actorId,
      note: `事業者の回答：${REQUEST_STATUS_LABELS[input.response]}${note ? `（${note}）` : ''}`,
    });
    await writeAuditLog(tx, {
      shopId: booking.shopId,
      actorId: input.actorId,
      action: 'booking.operator_response',
      targetType: 'booking',
      targetId: booking.id,
      after: { operatorId: input.operatorId, response: input.response, note },
    });
    return { bookingId: booking.id, shopId: booking.shopId, assigned };
  });
}

/** 予約への照会と回答の一覧（管理画面の予約詳細用） */
export async function listBookingRequests(db: DbOrTx, params: { shopId: string; bookingId: string }) {
  return (
    db
      .select({
        id: bookingOperatorRequests.id,
        operatorId: bookingOperatorRequests.operatorId,
        operatorName: operators.name,
        operatorEmail: operators.email,
        status: bookingOperatorRequests.status,
        requestNote: bookingOperatorRequests.requestNote,
        responseNote: bookingOperatorRequests.responseNote,
        requestedAt: bookingOperatorRequests.requestedAt,
        respondedAt: bookingOperatorRequests.respondedAt,
        respondedByName: user.name,
      })
      .from(bookingOperatorRequests)
      .innerJoin(bookings, eq(bookings.id, bookingOperatorRequests.bookingId))
      .innerJoin(operators, eq(operators.id, bookingOperatorRequests.operatorId))
      .leftJoin(user, eq(user.id, bookingOperatorRequests.respondedBy))
      .where(and(eq(bookingOperatorRequests.bookingId, params.bookingId), eq(bookings.shopId, params.shopId)))
      // 同時に依頼した社は名前の順に並べる（毎回同じ並びで出す）
      .orderBy(asc(bookingOperatorRequests.requestedAt), asc(operators.name))
  );
}

/** 事業者向けの照会の項目（お客様の連絡先は含めない。受入可否の判断に要る日時・プラン・人数・年齢・連絡事項だけ） */
function selectOperatorRequests(db: DbOrTx, where: SQL | undefined) {
  return db
    .select({
      id: bookingOperatorRequests.id,
      status: bookingOperatorRequests.status,
      requestNote: bookingOperatorRequests.requestNote,
      responseNote: bookingOperatorRequests.responseNote,
      requestedAt: bookingOperatorRequests.requestedAt,
      respondedAt: bookingOperatorRequests.respondedAt,
      bookingId: bookings.id,
      bookingNo: bookings.bookingNo,
      // この事業者が実施事業者に決まっているか（確定後は「予約が確定しました」と案内する）
      assignedToMe: sql<boolean>`coalesce(${bookings.operatorId} = ${bookingOperatorRequests.operatorId}, false)`,
      bookingStatus: bookings.status,
      partySize: bookings.partySize,
      guestCount: bookings.guestCount,
      participantAges: bookings.participantAges,
      customerNote: bookings.customerNote,
      secondChoice: bookings.secondChoice,
      startsAt: slots.startsAt,
      menuTitle: menuTranslations.title,
      capacityUnit: menus.capacityUnit,
    })
    .from(bookingOperatorRequests)
    .innerJoin(bookings, eq(bookings.id, bookingOperatorRequests.bookingId))
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .innerJoin(menus, eq(menus.id, slots.menuId))
    .innerJoin(menuTranslations, and(eq(menuTranslations.menuId, menus.id), eq(menuTranslations.locale, 'ja')))
    .where(where);
}

/** 事業者に届いた照会（回答待ちを先に、新しい順） */
export async function listOperatorRequests(
  db: DbOrTx,
  params: { operatorId: string; status?: RequestStatus[]; limit?: number },
) {
  const query = selectOperatorRequests(
    db,
    and(
      eq(bookingOperatorRequests.operatorId, params.operatorId),
      params.status ? inArray(bookingOperatorRequests.status, params.status) : undefined,
    ),
  ).orderBy(sql`(${bookingOperatorRequests.status} = 'pending') desc`, desc(bookingOperatorRequests.requestedAt));
  return params.limit ? query.limit(params.limit) : query;
}

export type OperatorRequest = Awaited<ReturnType<typeof listOperatorRequests>>[number];

/** 事業者の照会 1 件と人数の内訳（自社への照会だけ。他社の照会・存在しない照会は null） */
export async function getOperatorRequest(db: DbOrTx, params: { operatorId: string; requestId: string }) {
  const [row] = await selectOperatorRequests(
    db,
    and(eq(bookingOperatorRequests.id, params.requestId), eq(bookingOperatorRequests.operatorId, params.operatorId)),
  );
  if (!row) return null;
  const items = await db
    .select({ label: bookingItems.label, quantity: bookingItems.quantity })
    .from(bookingItems)
    .where(eq(bookingItems.bookingId, row.bookingId))
    .orderBy(asc(bookingItems.createdAt));
  return { ...row, items };
}

/** 事業者の回答待ちの照会の数（予約がまだ確定前のものだけ） */
export async function countPendingRequests(db: DbOrTx, operatorId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(bookingOperatorRequests)
    .innerJoin(bookings, eq(bookings.id, bookingOperatorRequests.bookingId))
    .where(
      and(
        eq(bookingOperatorRequests.operatorId, operatorId),
        eq(bookingOperatorRequests.status, 'pending'),
        inArray(bookings.status, ['requested', 'reviewing', 'operator_checking', 'awaiting_payment']),
      ),
    );
  return row?.n ?? 0;
}
