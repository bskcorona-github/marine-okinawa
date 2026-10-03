import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, ne, sql, type SQL } from 'drizzle-orm';
import type { Db, DbOrTx } from '@/db/client';
import {
  auditLogs,
  bookingItems,
  bookingOperatorRequests,
  bookings,
  bookingStatusEvents,
  menus,
  menuTranslations,
  operators,
  shops,
  slots,
} from '@/db/schema';
import { writeAuditLog } from '@/modules/audit/log';
import { changeBookingStatus } from '@/modules/booking/change-status';
import { BookingError } from '@/modules/booking/errors';
import { CONFIRMED_STATUSES, OPEN_REQUEST_STATUSES } from '@/modules/booking/status';
import { bookingStatusIn, cancelledAfterConfirmSql } from '@/modules/booking/status-sql';
import { DEFAULT_LOCALE } from '@/lib/locale';
import { isPerPerson } from '@/modules/catalog/capacity-unit';

/**
 * 事業者に見せる予約：自社に割り当てられ、支払待ち以降のもの。取消・天候中止は、一度確定した予約だけ
 * （確定前に取り消した申込は、照会していない初期値の事業者に見せない）
 */
const operatorVisibleSql = sql`(${bookingStatusIn(['awaiting_payment', ...CONFIRMED_STATUSES, 'no_show'])} or ${cancelledAfterConfirmSql})`;

/** 当日の連絡が要らなくなった予約（催行の報告のあと・無断キャンセル・開始の翌日以降）。電話を出さない */
const contactOverSql = (now: Date) =>
  sql`(${bookings.status} in ('completed', 'verified', 'settled', 'no_show') or ${slots.startsAt} < ${new Date(now.getTime() - 86_400_000)})`;

export type ReportResult = 'done' | 'cancelled' | 'no_show';

export const REPORT_RESULT_LABELS: Record<ReportResult, string> = {
  done: '実施',
  cancelled: '中止',
  no_show: '無断キャンセル',
};

/**
 * 事業者向けの予約の項目。催行に要る情報と代表者の氏名・電話・メール。
 * 取消の理由・組合メモ・金額の内訳・入金の状況は出さない
 */
function selectOperatorBookings(db: DbOrTx, where: SQL | undefined, now: Date) {
  return db
    .select({
      id: bookings.id,
      bookingNo: bookings.bookingNo,
      status: bookings.status,
      partySize: bookings.partySize,
      guestCount: bookings.guestCount,
      participantAges: bookings.participantAges,
      customerNote: bookings.customerNote,
      // 取消・天候中止になった予約では、代表者の連絡先を出さない。終わった予約では電話を出さない（氏名は照合用に残す）
      contactName: sql<
        string | null
      >`case when ${bookings.status} in ('cancelled', 'weather_cancelled') then null else ${bookings.contactName} end`,
      contactPhone: sql<
        string | null
      >`case when ${bookings.status} in ('cancelled', 'weather_cancelled') or ${contactOverSql(now)} then null else ${bookings.contactPhone} end`,
      contactEmail: sql<
        string | null
      >`case when ${bookings.status} in ('cancelled', 'weather_cancelled') then null else ${bookings.contactEmail} end`,
      shopId: bookings.shopId,
      totalAmount: bookings.totalAmount,
      paymentMethod: bookings.paymentMethod,
      reportResult: bookings.reportResult,
      actualPartySize: bookings.actualPartySize,
      reportNote: bookings.reportNote,
      reportedAt: bookings.reportedAt,
      // 取消のとき組合が事業者に伝えたこと（組合用の取消の理由は出さない）
      cancelOperatorNote: bookings.cancelOperatorNote,
      // 条件付きの回答について、組合と合意した内容
      operatorAgreement: bookings.operatorAgreement,
      startsAt: slots.startsAt,
      menuId: menus.id,
      menuTitle: menuTranslations.title,
      meetingPoint: menuTranslations.meetingPoint,
      capacityUnit: menus.capacityUnit,
      durationMin: menus.durationMin,
    })
    .from(bookings)
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .innerJoin(menus, eq(menus.id, slots.menuId))
    .innerJoin(
      menuTranslations,
      and(eq(menuTranslations.menuId, menus.id), eq(menuTranslations.locale, DEFAULT_LOCALE)),
    )
    .where(where);
}

/** 事業者の予約一覧（自社に割り当てられた、支払待ち以降のもの）。from〜to（開始日時）で絞る */
export async function listOperatorBookings(
  db: DbOrTx,
  params: { operatorId: string; now: Date; from?: Date; to?: Date; order?: 'asc' | 'desc'; limit?: number },
) {
  const query = selectOperatorBookings(
    db,
    and(
      eq(bookings.operatorId, params.operatorId),
      operatorVisibleSql,
      params.from ? gte(slots.startsAt, params.from) : undefined,
      params.to ? lt(slots.startsAt, params.to) : undefined,
    ),
    params.now,
  ).orderBy(params.order === 'desc' ? desc(slots.startsAt) : asc(slots.startsAt));
  return params.limit ? query.limit(params.limit) : query;
}

/** 催行報告待ち：自社の確定予約で、開始したのに報告していないもの */
const awaitingReportOf = (params: { operatorId: string; now: Date }) =>
  and(
    eq(bookings.operatorId, params.operatorId),
    eq(bookings.status, 'confirmed'),
    lte(slots.startsAt, params.now),
    isNull(bookings.reportResult),
  );

/**
 * 催行報告待ちの予約。件数で切らずに全部（古い順）。ホーム・予約一覧で同じものを使う
 */
export async function listAwaitingReport(db: DbOrTx, params: { operatorId: string; now: Date }) {
  return selectOperatorBookings(db, awaitingReportOf(params), params.now).orderBy(asc(slots.startsAt));
}

/** 催行報告待ちの件数（メニューの件数。行を読まずに数える） */
export async function countAwaitingReport(db: DbOrTx, params: { operatorId: string; now: Date }): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(bookings)
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .where(awaitingReportOf(params));
  return row?.count ?? 0;
}

/** 事業者画面の枠に出す、事業者名・組合名・組合の連絡先 */
export async function getPortalHeader(db: DbOrTx, operatorId: string) {
  const [row] = await db
    .select({ name: operators.name, shopName: shops.name, profile: shops.profile })
    .from(operators)
    .innerJoin(shops, eq(shops.id, operators.shopId))
    .where(eq(operators.id, operatorId));
  return row ?? null;
}

/** 事業者を停止する前に見せる件数：これからの確定予約と、回答待ちの照会（確定前の申込） */
export async function countOperatorWorkload(db: DbOrTx, params: { operatorId: string; now: Date }) {
  const [upcoming] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(bookings)
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .where(
      and(
        eq(bookings.operatorId, params.operatorId),
        inArray(bookings.status, ['awaiting_payment', 'confirmed']),
        gte(slots.startsAt, params.now),
      ),
    );
  const [requests] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(bookingOperatorRequests)
    .innerJoin(bookings, eq(bookings.id, bookingOperatorRequests.bookingId))
    .where(
      and(
        eq(bookingOperatorRequests.operatorId, params.operatorId),
        eq(bookingOperatorRequests.status, 'pending'),
        bookingStatusIn(OPEN_REQUEST_STATUSES),
      ),
    );
  return { upcoming: upcoming?.count ?? 0, openRequests: requests?.count ?? 0 };
}

export type RecentChangeKind = 'cancelled' | 'weather_cancelled' | 'released' | 'slot' | 'items';

/**
 * 最近の変更（確定したあとの取消・天候中止・担当の変更・日時や人数の変更）。メールを見落としても、
 * ホームで気づけるようにする。担当から外れた予約は、もう事業者には見せない（予約の詳細へは案内しない）
 */
export async function listRecentChanges(db: DbOrTx, params: { operatorId: string; shopId: string; since: Date }) {
  const me = params.operatorId;
  // 変更の時点で、一度確定していた予約だけ（確定前の変更は、確定のお知らせに最新の内容が載る）
  const confirmedBefore = sql`exists (select 1 from ${bookingStatusEvents} e where e.booking_id = ${bookings.id} and e.to_status = 'confirmed' and e.created_at <= ${auditLogs.createdAt})`;
  const kind = sql<RecentChangeKind>`case
    when ${auditLogs.action} = 'booking.assign_operator' then 'released'
    when ${auditLogs.action} = 'booking.change_slot' then 'slot'
    when ${auditLogs.action} = 'booking.change_items' then 'items'
    else ${auditLogs.after}->>'status' end`;
  return db
    .select({
      id: auditLogs.id,
      kind,
      at: auditLogs.createdAt,
      bookingId: bookings.id,
      bookingNo: bookings.bookingNo,
      startsAt: slots.startsAt,
      partySize: bookings.partySize,
      guestCount: bookings.guestCount,
      capacityUnit: menus.capacityUnit,
      menuTitle: menuTranslations.title,
    })
    .from(auditLogs)
    .innerJoin(bookings, sql`${bookings.id}::text = ${auditLogs.targetId}`)
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .innerJoin(menus, eq(menus.id, slots.menuId))
    .innerJoin(
      menuTranslations,
      and(eq(menuTranslations.menuId, menus.id), eq(menuTranslations.locale, DEFAULT_LOCALE)),
    )
    .where(
      and(
        eq(auditLogs.shopId, params.shopId),
        eq(auditLogs.targetType, 'booking'),
        gte(auditLogs.createdAt, params.since),
        confirmedBefore,
        sql`(
          (${auditLogs.action} in ('booking.change_slot', 'booking.change_items') and ${bookings.operatorId} = ${me})
          or (${auditLogs.action} = 'booking.status' and ${auditLogs.after}->>'status' in ('cancelled', 'weather_cancelled') and ${bookings.operatorId} = ${me})
          or (${auditLogs.action} = 'booking.assign_operator' and ${auditLogs.before}->>'operatorId' = ${me}
            and ${auditLogs.after}->>'operatorId' is distinct from ${me})
        )`,
      ),
    )
    .orderBy(desc(auditLogs.createdAt))
    .limit(20);
}

/** 事業者の予約 1 件と明細（自社に割り当てられた支払待ち以降のものだけ。それ以外は null） */
export async function getOperatorBooking(db: DbOrTx, params: { operatorId: string; bookingId: string; now: Date }) {
  const [row] = await selectOperatorBookings(
    db,
    and(eq(bookings.id, params.bookingId), eq(bookings.operatorId, params.operatorId), operatorVisibleSql),
    params.now,
  );
  if (!row) return null;
  const [items, [request]] = await Promise.all([
    db
      .select({ label: bookingItems.label, quantity: bookingItems.quantity })
      .from(bookingItems)
      .where(eq(bookingItems.bookingId, row.id))
      .orderBy(asc(bookingItems.createdAt)),
    // 自社の受入確認の回答（条件付きで答えた条件などを、予約の詳細でも見られるように）
    db
      .select({
        id: bookingOperatorRequests.id,
        status: bookingOperatorRequests.status,
        responseNote: bookingOperatorRequests.responseNote,
        respondedAt: bookingOperatorRequests.respondedAt,
      })
      .from(bookingOperatorRequests)
      .where(
        and(
          eq(bookingOperatorRequests.bookingId, row.id),
          eq(bookingOperatorRequests.operatorId, params.operatorId),
          ne(bookingOperatorRequests.status, 'withdrawn'),
        ),
      ),
  ]);
  return { ...row, items, request: request ?? null };
}

export type OperatorBooking = NonNullable<Awaited<ReturnType<typeof getOperatorBooking>>>;

/**
 * 事業者の催行報告（自社の確定予約で、開始したものだけ）。
 * 実施：実績人数を記録して「催行済み」にする。中止・無断キャンセル：報告として残し、組合が状態を変える
 * （返金などの扱いは組合が決めるため）。報告は、組合が状態を変えるまでは出し直せる
 */
export async function reportActivity(
  db: Db,
  input: {
    operatorId: string;
    bookingId: string;
    result: ReportResult;
    actualPartySize: number | null;
    note: string;
    actorId: string | null;
    now: Date;
  },
): Promise<{ shopId: string; status: string }> {
  const booking = await getOperatorBooking(db, {
    operatorId: input.operatorId,
    bookingId: input.bookingId,
    now: input.now,
  });
  if (!booking) throw new BookingError('BOOKING_NOT_FOUND');
  if (booking.status !== 'confirmed') throw new BookingError('INVALID_TRANSITION');
  if (booking.startsAt > input.now) throw new BookingError('NOT_STARTED');
  const actual = input.result === 'done' ? input.actualPartySize : null;
  if (input.result === 'done' && (!Number.isInteger(actual) || actual! < 0 || actual! > 500)) {
    throw new BookingError('INVALID_ITEMS');
  }
  const note = input.note.trim();
  // 貸切（艇で数えるプラン）の実績は乗船人数（名）
  const charter = !isPerPerson(booking.capacityUnit);
  const label = `${REPORT_RESULT_LABELS[input.result]}${actual !== null ? `（実績${charter ? 'の乗船人数' : ''} ${actual}${charter ? '名' : booking.capacityUnit}）` : ''}${note ? `：${note}` : ''}`;
  const report = {
    reportResult: input.result,
    actualPartySize: actual,
    reportNote: note,
    reportedAt: input.now,
    reportedBy: input.actorId,
  };
  if (input.result === 'done') {
    // 状態の変更と報告の保存を 1 つのトランザクションで行う。状態を先に変える（確定・開始済みの確認と、
    // 同時に報告されたときの二重の反映は、ここで止まる）。そのあいだに割り当てが変わっていたら、全部取り消す
    return db.transaction(async (tx) => {
      await changeBookingStatus(tx, {
        shopId: booking.shopId,
        bookingId: booking.id,
        to: 'completed',
        actor: { type: 'operator', id: input.actorId },
        note: `催行報告：${label}`,
        now: input.now,
      });
      const [row] = await tx
        .update(bookings)
        .set(report)
        .where(and(eq(bookings.id, booking.id), eq(bookings.operatorId, input.operatorId)))
        .returning({ id: bookings.id });
      if (!row) throw new BookingError('BOOKING_NOT_FOUND');
      await writeAuditLog(tx, {
        shopId: booking.shopId,
        actorId: input.actorId,
        action: 'booking.operator_report',
        targetType: 'booking',
        targetId: booking.id,
        after: { result: input.result, actualPartySize: actual, note },
      });
      return { shopId: booking.shopId, status: 'completed' };
    });
  }
  return db.transaction(async (tx) => {
    // 中止・無断キャンセルは報告として残すだけ（状態は組合が返金の扱いと合わせて変える）
    const [row] = await tx
      .update(bookings)
      .set(report)
      .where(
        and(eq(bookings.id, booking.id), eq(bookings.status, 'confirmed'), eq(bookings.operatorId, input.operatorId)),
      )
      .returning({ shopId: bookings.shopId });
    if (!row) throw new BookingError('INVALID_TRANSITION');
    await tx.insert(bookingStatusEvents).values({
      bookingId: booking.id,
      fromStatus: 'confirmed',
      toStatus: 'confirmed',
      actorType: 'operator',
      actorId: input.actorId,
      note: `催行報告：${label}（組合の確認待ち）`,
    });
    await writeAuditLog(tx, {
      shopId: row.shopId,
      actorId: input.actorId,
      action: 'booking.operator_report',
      targetType: 'booking',
      targetId: booking.id,
      after: { result: input.result, actualPartySize: actual, note },
    });
    return { shopId: row.shopId, status: 'confirmed' };
  });
}
