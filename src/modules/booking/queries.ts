import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import {
  auditLogs,
  bookingAccessTokens,
  bookingOperatorRequests,
  bookingItems,
  bookings,
  bookingStatusEvents,
  menuPrices,
  menus,
  menuTranslations,
  notifications,
  operators,
  paymentEvents,
  paymentReceipts,
  paymentRefunds,
  payments,
  shops,
  slots,
  user,
} from '@/db/schema';
import { addDays, zonedToUtc } from '@/lib/dates';
import { normalizePhone } from '@/modules/customer/normalize';
import { resolveSettings } from '@/modules/shop/settings';
import { hashAccessToken } from './access-token';
import { bookingStatusIn, confirmedOnceSql } from './status-sql';
import {
  BEFORE_PAYMENT_REQUEST_STATUSES,
  CONFIRMED_STATUSES as ACTIVE_STATUSES,
  ENDED_STATUSES,
  OPEN_REQUEST_STATUSES,
  SEAT_HOLDING_STATUSES,
  type BookingStatus,
} from './status';
import { BOOKING_HISTORY_ACTION_LIST } from './history';
import { DEFAULT_LOCALE } from '@/lib/locale';

async function loadSummary(db: DbOrTx, condition: SQL) {
  const [row] = await db
    .select({
      id: bookings.id,
      shopId: bookings.shopId,
      bookingNo: bookings.bookingNo,
      status: bookings.status,
      source: bookings.source,
      paymentMethod: bookings.paymentMethod,
      partySize: bookings.partySize,
      guestCount: bookings.guestCount,
      extraGuestAmount: bookings.extraGuestAmount,
      extraGuestCount: bookings.extraGuestCount,
      totalAmount: bookings.totalAmount,
      locale: bookings.locale,
      contactName: bookings.contactName,
      contactEmail: bookings.contactEmail,
      contactPhone: bookings.contactPhone,
      customerId: bookings.customerId,
      overCapacityReason: bookings.overCapacityReason,
      cancelledAt: bookings.cancelledAt,
      cancelReason: bookings.cancelReason,
      cancelCategory: bookings.cancelCategory,
      cancelOperatorNote: bookings.cancelOperatorNote,
      operatorAgreement: bookings.operatorAgreement,
      createdAt: bookings.createdAt,
      secondChoice: bookings.secondChoice,
      customerNote: bookings.customerNote,
      participantAges: bookings.participantAges,
      consentedAt: bookings.consentedAt,
      adminNote: bookings.adminNote,
      policySnapshot: bookings.policySnapshot,
      reportResult: bookings.reportResult,
      actualPartySize: bookings.actualPartySize,
      reportNote: bookings.reportNote,
      reportedAt: bookings.reportedAt,
      operatorId: bookings.operatorId,
      operatorAssignedVia: bookings.operatorAssignedVia,
      slotId: slots.id,
      slotStatus: slots.status,
      startsAt: slots.startsAt,
      durationMin: menus.durationMin,
      menuId: menus.id,
      menuSlug: menus.slug,
      capacityUnit: menus.capacityUnit,
      menuTitle: menuTranslations.title,
      meetingPoint: menuTranslations.meetingPoint,
      meetingAddress: menuTranslations.meetingAddress,
      meetingMapUrl: menus.meetingMapUrl,
      whatToBring: menuTranslations.whatToBring,
      included: menuTranslations.included,
      cancellationPolicy: menuTranslations.cancellationPolicy,
      weatherPolicy: menuTranslations.weatherPolicy,
      shopName: shops.name,
      shopSettings: shops.settings,
      shopPhone: sql<string | null>`${shops.profile} ->> 'phone'`,
      shopEmail: sql<string | null>`${shops.profile} ->> 'email'`,
      shopBusinessHours: sql<string | null>`${shops.profile} ->> 'businessHours'`,
      // 領収書に載せる（組合の所在地、事業者のインボイスの登録番号）
      shopAddress: sql<string | null>`${shops.profile} ->> 'address'`,
      timezone: shops.timezone,
      operatorName: operators.name,
      operatorPhone: operators.phone,
      operatorContactHours: operators.contactHours,
      operatorInvoiceNumber: operators.invoiceNumber,
      paymentStatus: payments.status,
      paymentAmount: payments.amount,
      paymentDueAt: payments.dueAt,
      paymentReceivedAt: payments.receivedAt,
      /** カード決済（Stripe）で受け取ったとき（返金を Stripe へ送るため） */
      stripePaymentIntentId: payments.stripePaymentIntentId,
      refundDueAmount: payments.refundDueAmount,
      refundedAmount: payments.refundedAmount,
      refundedAt: payments.refundedAt,
      /** 代金を受け取った方法（最初の「代金」の入金。二重のお支払い・追加の入金の方法では決めない） */
      paymentReceiptMethod: sql<'transfer' | 'card' | 'other' | null>`(select r.method from ${paymentReceipts} r
        where r.payment_id = ${payments.id} and r.purpose = 'payment' order by r.received_at limit 1)`,
      /** 一度でも予約確定になったか（取消のあとでも、確定していたなら領収書・キャンセル料の対象） */
      confirmedOnce: confirmedOnceSql,
    })
    .from(bookings)
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .innerJoin(menus, eq(menus.id, slots.menuId))
    // 多言語に対応するときに、予約の言語（bookings.locale）の翻訳に切り替える
    .innerJoin(
      menuTranslations,
      and(eq(menuTranslations.menuId, menus.id), eq(menuTranslations.locale, DEFAULT_LOCALE)),
    )
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    // 実施事業者は予約ごとに組合が割り当てる（お客様には予約確定まで見せない）
    .leftJoin(operators, eq(operators.id, bookings.operatorId))
    .leftJoin(payments, eq(payments.bookingId, bookings.id))
    .where(condition);
  if (!row) return null;
  const rows = await db
    .select({
      priceId: bookingItems.priceId,
      label: bookingItems.label,
      unitPrice: bookingItems.unitPrice,
      quantity: bookingItems.quantity,
      meetingPoint: menuPrices.meetingPoint,
    })
    .from(bookingItems)
    .innerJoin(menuPrices, eq(menuPrices.id, bookingItems.priceId))
    .where(eq(bookingItems.bookingId, row.id))
    .orderBy(asc(bookingItems.createdAt));
  const items = rows.map((r) => ({ priceId: r.priceId, label: r.label, unitPrice: r.unitPrice, quantity: r.quantity }));
  // 出発港を選ぶ貸切などで、予約したコースに集合場所があればそちらを案内する
  const meetingPoint = rows.find((r) => r.meetingPoint)?.meetingPoint ?? row.meetingPoint;
  const { shopSettings, ...rest } = row;
  return { ...rest, settings: resolveSettings(shopSettings), meetingPoint, items };
}

export type BookingSummary = NonNullable<Awaited<ReturnType<typeof loadSummary>>>;

/** ゲストの予約確認ページ用。期限切れ・不一致は null（メールごとのトークンのどれでも開ける） */
export async function getBookingByAccessToken(db: DbOrTx, params: { token: string; now: Date }) {
  const byToken = db
    .select({ bookingId: bookingAccessTokens.bookingId })
    .from(bookingAccessTokens)
    .where(eq(bookingAccessTokens.tokenHash, hashAccessToken(params.token)));
  return loadSummary(db, and(inArray(bookings.id, byToken), gt(bookings.accessTokenExpiresAt, params.now))!);
}

export async function getBookingSummaryById(db: DbOrTx, bookingId: string) {
  return loadSummary(db, eq(bookings.id, bookingId));
}

export async function getBookingDetail(db: DbOrTx, params: { shopId: string; bookingId: string }) {
  const summary = await loadSummary(db, and(eq(bookings.id, params.bookingId), eq(bookings.shopId, params.shopId))!);
  if (!summary) return null;
  const [payment] = await db.select().from(payments).where(eq(payments.bookingId, summary.id));
  return { ...summary, payment: payment ?? null };
}

/** 予約の状態の履歴と、入金・返金・日時変更などの操作ログ（管理画面の予約詳細用。古い順） */
export async function listBookingHistory(db: DbOrTx, params: { shopId: string; bookingId: string }) {
  const [events, logs] = await Promise.all([
    db
      .select({
        id: bookingStatusEvents.id,
        at: bookingStatusEvents.createdAt,
        fromStatus: bookingStatusEvents.fromStatus,
        toStatus: bookingStatusEvents.toStatus,
        actorType: bookingStatusEvents.actorType,
        actorName: user.name,
        actorEmail: user.email,
        note: bookingStatusEvents.note,
      })
      .from(bookingStatusEvents)
      .innerJoin(bookings, eq(bookings.id, bookingStatusEvents.bookingId))
      .leftJoin(user, eq(user.id, bookingStatusEvents.actorId))
      .where(and(eq(bookingStatusEvents.bookingId, params.bookingId), eq(bookings.shopId, params.shopId)))
      .orderBy(asc(bookingStatusEvents.createdAt)),
    db
      .select({
        id: auditLogs.id,
        at: auditLogs.createdAt,
        action: auditLogs.action,
        after: auditLogs.after,
        actorType: auditLogs.actorType,
        actorName: user.name,
        actorEmail: user.email,
      })
      .from(auditLogs)
      .leftJoin(user, eq(user.id, auditLogs.actorId))
      .where(
        and(
          eq(auditLogs.shopId, params.shopId),
          eq(auditLogs.targetType, 'booking'),
          eq(auditLogs.targetId, params.bookingId),
          inArray(auditLogs.action, BOOKING_HISTORY_ACTION_LIST),
        ),
      )
      .orderBy(asc(auditLogs.createdAt)),
  ]);
  return { events, logs };
}

/**
 * 絞り込みの「状態」：個々の状態のほか、未対応（確定前の申込）・確定済み（確定〜精算）のまとめと、
 * ダッシュボードの「要対応」（催行報告待ち・事業者からの中止などの報告・事業者の回答あり）
 */
export type StatusFilter =
  BookingStatus | 'open' | 'active' | 'in_review' | 'awaiting_report' | 'operator_report' | 'operator_responded';

export const STATUS_GROUP_LABELS: Record<Exclude<StatusFilter, BookingStatus>, string> = {
  open: '未確定の申込（仮受付〜支払待ち）',
  active: '確定済み（予約確定〜精算済み）',
  in_review: '内容確認中・事業者確認中',
  operator_responded: '事業者の回答あり（組合の対応待ち）',
  awaiting_report: '催行報告待ち（開始済みの予約確定）',
  operator_report: '事業者から中止・無断キャンセルの報告',
};

export type BookingSearchParams = {
  shopId: string;
  /** 予約番号・名前・電話番号（下 4 桁などの部分一致も可） */
  query: string;
  timezone: string;
  /** 参加日（ショップのタイムゾーン）の範囲で絞り込む（to を省くと from の 1 日だけ） */
  date?: string | null;
  dateTo?: string | null;
  status?: StatusFilter | null;
  menuId?: string | null;
  operatorId?: string | null;
  /** 最後に送ったお客様へのメールが届かなかった（送信に失敗した・結果不明の）予約だけ */
  mailFailed?: boolean;
  /** 入金の状況で絞り込む（期限切れの判定に now を使う） */
  payment?: PaymentFilter | null;
  now?: Date;
  /** 並び順：参加日の近い順（date）か申込の新しい順（created）。省略時は参加日を指定したら date */
  sort?: 'date' | 'created';
  page?: number;
  pageSize?: number;
};

/**
 * 入金の状況の区分。before：支払案内の前（申込の確認中）、awaiting：支払待ち、overdue：支払期限切れ、
 * held：入金済み・確定待ち（カードで払われたが、実施事業者の受入・金額の確認で確定を保留した）、
 * paid：入金済み、refund_due：返金待ち（返金予定額のうち未返金の分がある）、refunded：返金済み（一部を含む）、
 * overpaid：料金より多い入金（二重のお支払い・人数が減ったなど。返金するか確かめる）、
 * refund_sending：カードへの返金の結果待ち、dispute：チャージバックの対応中
 */
export type PaymentFilter =
  | 'before'
  | 'awaiting'
  | 'overdue'
  | 'held'
  | 'paid'
  | 'refund_due'
  | 'refunded'
  | 'overpaid'
  | 'refund_sending'
  | 'dispute';

export const PAYMENT_FILTER_LABELS: Record<PaymentFilter, string> = {
  before: '支払案内の前',
  awaiting: '支払待ち',
  overdue: '支払期限切れ',
  held: '入金済み・確定待ち',
  paid: '入金済み',
  refund_due: '返金待ち',
  refunded: '返金済み',
  overpaid: '料金より多い入金',
  refund_sending: 'カード返金の結果待ち',
  dispute: 'チャージバック対応中',
};

/** 返金予定額のうち、まだ返金していない分がある */
const refundDueSql = sql`(${payments.refundDueAmount} is not null and ${payments.refundDueAmount} > ${payments.refundedAmount} and ${payments.status} in ('paid', 'partially_refunded'))`;

/** 取消などで終わっていない予約で、手元に残る入金（受け取り − 返金）が料金より多い */
const overpaidSql = and(
  inArray(payments.status, ['paid', 'partially_refunded']),
  notInArray(bookings.status, [...ENDED_STATUSES]),
  sql`${payments.amount} - ${payments.refundedAmount} > ${bookings.totalAmount}`,
)!;

/** カードへの返金を送ったが、結果がまだ分からない */
const refundSendingSql = sql`exists (select 1 from ${paymentRefunds} r where r.payment_id = ${payments.id} and r.status = 'pending')`;

/** チャージバックの申し立てがあり、まだ決着していない */
const disputeOpenSql = sql`exists (select 1 from ${paymentEvents} e where e.payment_id = ${payments.id} and e.result = 'dispute_open')`;

function paymentCondition(filter: PaymentFilter, now: Date): SQL {
  switch (filter) {
    case 'before':
      return and(bookingStatusIn(BEFORE_PAYMENT_REQUEST_STATUSES), eq(bookings.paymentMethod, 'online'))!;
    case 'awaiting':
      return eq(bookings.status, 'awaiting_payment');
    case 'overdue':
      return and(eq(bookings.status, 'awaiting_payment'), eq(payments.status, 'pending'), lt(payments.dueAt, now))!;
    case 'held':
      return and(eq(bookings.status, 'awaiting_payment'), eq(payments.status, 'paid'))!;
    case 'paid':
      return and(eq(payments.status, 'paid'), sql`not ${refundDueSql}`)!;
    case 'refund_due':
      return refundDueSql;
    case 'refunded':
      return inArray(payments.status, ['refunded', 'partially_refunded']);
    case 'overpaid':
      return overpaidSql;
    case 'refund_sending':
      return refundSendingSql;
    case 'dispute':
      return disputeOpenSql;
  }
}

/** お客様に送るメールの種類（組合への通知は「メール未達」の判定に入れない） */
const CUSTOMER_MAIL_TYPES = ['requested', 'payment_request', 'confirmed', 'cancelled', 'reminder', 'weather_cancel'];

/**
 * 事業者の回答を組合がまだ受けて動いていない、確定前の申込。回答が「最後の照会」と「組合が最後に状態を変えた時刻」の
 * どちらよりも後なら数える（支払案内のあとに受入不可へ直した回答も拾い、照会し直したあとの古い回答は数えない）
 */
const operatorRespondedSql = sql`(${bookingStatusIn(OPEN_REQUEST_STATUSES)} and exists (
  select 1 from ${bookingOperatorRequests} r
  where r.booking_id = ${bookings.id}
    and r.status in ('accepted', 'conditional', 'declined')
    and r.responded_at >= (select max(r2.requested_at) from ${bookingOperatorRequests} r2 where r2.booking_id = ${bookings.id})
    and r.responded_at >= coalesce(
      (select max(e.created_at) from ${bookingStatusEvents} e
        where e.booking_id = ${bookings.id} and e.actor_type = 'staff' and e.from_status is distinct from e.to_status),
      '-infinity'::timestamptz)
))`;

function statusCondition(status: StatusFilter, now: Date): SQL {
  switch (status) {
    case 'open':
      return inArray(bookings.status, [...OPEN_REQUEST_STATUSES]);
    case 'active':
      return inArray(bookings.status, [...ACTIVE_STATUSES]);
    case 'in_review':
      return inArray(bookings.status, ['reviewing', 'operator_checking']);
    case 'awaiting_report':
      return and(eq(bookings.status, 'confirmed'), lt(slots.startsAt, now), isNull(bookings.reportResult))!;
    case 'operator_report':
      return and(eq(bookings.status, 'confirmed'), inArray(bookings.reportResult, ['cancelled', 'no_show']))!;
    case 'operator_responded':
      return operatorRespondedSql;
    default:
      return eq(bookings.status, status);
  }
}

function searchConditions(params: BookingSearchParams): SQL[] {
  const q = params.query.trim();
  const conditions: SQL[] = [eq(bookings.shopId, params.shopId)];
  if (q) {
    const phone = normalizePhone(q);
    // 電話番号は国番号付きで保存しているので、数字だけにして先頭の 0 を除いた部分一致でも探す
    const digits = q.replace(/\D/g, '').replace(/^0/, '');
    const byText = or(
      eq(bookings.bookingNo, q.toUpperCase()),
      ilike(bookings.contactName, `%${q.replace(/[%_\\]/g, '\\$&')}%`),
      ...(phone ? [eq(bookings.contactPhone, phone)] : []),
      ...(digits.length >= 4
        ? [sql`regexp_replace(coalesce(${bookings.contactPhone}, ''), '[^0-9]', '', 'g') like ${`%${digits}%`}`]
        : []),
    );
    if (byText) conditions.push(byText);
  }
  if (params.date) {
    const to = params.dateTo && params.dateTo >= params.date ? params.dateTo : params.date;
    conditions.push(
      gte(slots.startsAt, zonedToUtc(params.date, '00:00', params.timezone)),
      lt(slots.startsAt, zonedToUtc(addDays(to, 1), '00:00', params.timezone)),
    );
  }
  if (params.status) conditions.push(statusCondition(params.status, params.now ?? new Date()));
  if (params.menuId) conditions.push(eq(slots.menuId, params.menuId));
  if (params.operatorId) conditions.push(eq(bookings.operatorId, params.operatorId));
  if (params.mailFailed) conditions.push(sql`${lastMailStatus} in ('failed', 'bounced', 'unknown')`);
  if (params.payment) conditions.push(paymentCondition(params.payment, params.now ?? new Date()));
  return conditions;
}

// 最後に送ったお客様へのメールの状態（送れなかった予約に印を付け、絞り込みにも使う）
const lastMailStatus = sql<
  string | null
>`(select ${notifications.status} from ${notifications} where ${notifications.bookingId} = ${bookings.id} and ${notifications.type} in (${sql.join(
  CUSTOMER_MAIL_TYPES.map((t) => sql`${t}`),
  sql`, `,
)}) order by ${notifications.createdAt} desc limit 1)`;

const searchColumns = {
  id: bookings.id,
  bookingNo: bookings.bookingNo,
  status: bookings.status,
  source: bookings.source,
  partySize: bookings.partySize,
  contactName: bookings.contactName,
  contactPhone: bookings.contactPhone,
  contactEmail: bookings.contactEmail,
  startsAt: slots.startsAt,
  menuTitle: menuTranslations.title,
  capacityUnit: menus.capacityUnit,
  guestCount: bookings.guestCount,
  totalAmount: bookings.totalAmount,
  operatorName: operators.name,
  paymentMethod: bookings.paymentMethod,
  paymentStatus: payments.status,
  paymentDueAt: payments.dueAt,
  refundDue: refundDueSql.mapWith(Boolean),
  createdAt: bookings.createdAt,
  lastMailStatus,
};

function searchQuery(db: DbOrTx, params: BookingSearchParams) {
  return db
    .select(searchColumns)
    .from(bookings)
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .innerJoin(menus, eq(menus.id, slots.menuId))
    .innerJoin(
      menuTranslations,
      and(eq(menuTranslations.menuId, slots.menuId), eq(menuTranslations.locale, DEFAULT_LOCALE)),
    )
    .leftJoin(operators, eq(operators.id, bookings.operatorId))
    .leftJoin(payments, eq(payments.bookingId, bookings.id))
    .where(and(...searchConditions(params)))
    .orderBy(
      ...((params.sort ?? (params.date ? 'date' : 'created')) === 'date'
        ? [asc(slots.startsAt), asc(bookings.createdAt)]
        : [desc(bookings.createdAt)]),
    );
}

/**
 * 管理画面の予約検索。日付を指定したときは開始時刻順、それ以外は受付の新しい順。
 * 次のページがあるかどうかは 1 件多く取って判定する
 */
export async function searchBookings(db: DbOrTx, params: BookingSearchParams) {
  const pageSize = params.pageSize ?? 50;
  const page = Math.max(1, params.page ?? 1);
  const rows = await searchQuery(db, params)
    .limit(pageSize + 1)
    .offset((page - 1) * pageSize);
  return { rows: rows.slice(0, pageSize), hasMore: rows.length > pageSize, page };
}

/** CSV に出す件数の上限（大きすぎる出力でサーバーを止めないように） */
export const EXPORT_LIMIT = 5000;

/** CSV 出力用：絞り込みに合う予約をすべて（上限つき）。明細・入金・返金・申込の内容も含める */
export async function exportBookings(db: DbOrTx, params: BookingSearchParams, limit = EXPORT_LIMIT) {
  const rows = await db
    .select({
      ...searchColumns,
      secondChoice: bookings.secondChoice,
      customerNote: bookings.customerNote,
      participantAges: bookings.participantAges,
      extraGuestAmount: bookings.extraGuestAmount,
      paymentAmount: payments.amount,
      paymentReceivedAt: payments.receivedAt,
      refundDueAmount: payments.refundDueAmount,
      refundedAmount: payments.refundedAmount,
      refundedAt: payments.refundedAt,
      cancelledAt: bookings.cancelledAt,
      cancelReason: bookings.cancelReason,
      cancelCategory: bookings.cancelCategory,
      updatedAt: bookings.updatedAt,
    })
    .from(bookings)
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .innerJoin(menus, eq(menus.id, slots.menuId))
    .innerJoin(
      menuTranslations,
      and(eq(menuTranslations.menuId, slots.menuId), eq(menuTranslations.locale, DEFAULT_LOCALE)),
    )
    .leftJoin(operators, eq(operators.id, bookings.operatorId))
    .leftJoin(payments, eq(payments.bookingId, bookings.id))
    .where(and(...searchConditions(params)))
    .orderBy(asc(slots.startsAt), asc(bookings.createdAt))
    .limit(limit + 1);
  const ids = rows.slice(0, limit).map((r) => r.id);
  const items = ids.length
    ? await db
        .select({ bookingId: bookingItems.bookingId, label: bookingItems.label, quantity: bookingItems.quantity })
        .from(bookingItems)
        .where(inArray(bookingItems.bookingId, ids))
        .orderBy(asc(bookingItems.createdAt))
    : [];
  const itemsOf = new Map<string, { label: string; quantity: number }[]>();
  for (const item of items) itemsOf.set(item.bookingId, [...(itemsOf.get(item.bookingId) ?? []), item]);
  return {
    rows: rows.slice(0, limit).map((r) => ({ ...r, items: itemsOf.get(r.id) ?? [] })),
    truncated: rows.length > limit,
  };
}

/** 回の予約者一覧（管理画面） */
export async function listSlotBookings(db: DbOrTx, params: { shopId: string; slotId: string }) {
  return db
    .select({
      id: bookings.id,
      bookingNo: bookings.bookingNo,
      status: bookings.status,
      source: bookings.source,
      partySize: bookings.partySize,
      guestCount: bookings.guestCount,
      contactName: bookings.contactName,
      contactPhone: bookings.contactPhone,
      totalAmount: bookings.totalAmount,
      paymentStatus: payments.status,
      paymentAmount: payments.amount,
      refundedAmount: payments.refundedAmount,
      policySnapshot: bookings.policySnapshot,
      paymentMethod: bookings.paymentMethod,
      operatorId: bookings.operatorId,
      // メールで知らせられるか（ない予約は電話で伝える）
      hasEmail: sql<boolean>`coalesce(${bookings.contactEmail}, '') <> ''`,
    })
    .from(bookings)
    .leftJoin(payments, eq(payments.bookingId, bookings.id))
    .where(and(eq(bookings.shopId, params.shopId), eq(bookings.slotId, params.slotId)))
    .orderBy(asc(bookings.createdAt));
}

/** 参加人数（名で数えるプランは人数、艇で数える貸切は乗船人数） */
export const participantsSql = sql<number>`coalesce(sum(case when ${menus.capacityUnit} = '名' then ${bookings.partySize} else coalesce(${bookings.guestCount}, 0) end), 0)`;

/**
 * 参加日（ショップのタイムゾーン）の範囲の確定予約（確定〜精算）の件数・参加人数・金額。
 * 貸切（艇で数えるプラン）は艇の数ではなく乗船人数で数える（乗船人数が未入力の予約は数えない）
 */
export async function getPeriodSummary(
  db: DbOrTx,
  params: { shopId: string; timezone: string; from: string; to: string },
) {
  const [row] = await db
    .select({
      bookings: count(),
      participants: participantsSql.mapWith(Number),
      amount: sql<number>`coalesce(sum(${bookings.totalAmount}), 0)`.mapWith(Number),
    })
    .from(bookings)
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .innerJoin(menus, eq(menus.id, slots.menuId))
    .where(
      and(
        eq(bookings.shopId, params.shopId),
        inArray(bookings.status, [...ACTIVE_STATUSES]),
        gte(slots.startsAt, zonedToUtc(params.from, '00:00', params.timezone)),
        lt(slots.startsAt, zonedToUtc(addDays(params.to, 1), '00:00', params.timezone)),
      ),
    );
  return row;
}

/** ある日（ショップのタイムゾーン）の確定予約の件数と参加人数 */
export async function getDaySummary(db: DbOrTx, params: { shopId: string; timezone: string; date: string }) {
  return getPeriodSummary(db, { ...params, from: params.date, to: params.date });
}

/**
 * ダッシュボードの「要対応」の件数：未対応の申込（状態ごと）、支払期限切れ、催行報告待ち（開始済みの確定予約）、
 * 実績確認待ち（催行済み）
 */
export async function getActionCounts(db: DbOrTx, params: { shopId: string; now: Date }) {
  const byStatus = await db
    .select({ status: bookings.status, count: count() })
    .from(bookings)
    .where(and(eq(bookings.shopId, params.shopId), inArray(bookings.status, [...OPEN_REQUEST_STATUSES, 'completed'])))
    .groupBy(bookings.status);
  const [overdue] = await db
    .select({ count: count() })
    .from(bookings)
    .innerJoin(payments, eq(payments.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.shopId, params.shopId),
        eq(bookings.status, 'awaiting_payment'),
        eq(payments.status, 'pending'),
        lt(payments.dueAt, params.now),
      ),
    );
  // カードで払われたが、確定を保留している予約（組合が確かめて確定する）
  const [paymentHeld] = await db
    .select({ count: count() })
    .from(bookings)
    .innerJoin(payments, eq(payments.bookingId, bookings.id))
    .where(
      and(eq(bookings.shopId, params.shopId), eq(bookings.status, 'awaiting_payment'), eq(payments.status, 'paid')),
    );
  const [awaitingReport] = await db
    .select({ count: count() })
    .from(bookings)
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .where(
      and(
        eq(bookings.shopId, params.shopId),
        eq(bookings.status, 'confirmed'),
        lt(slots.startsAt, params.now),
        isNull(bookings.reportResult),
      ),
    );
  const [refundPending] = await db
    .select({ count: count() })
    .from(bookings)
    .innerJoin(payments, eq(payments.bookingId, bookings.id))
    .where(and(eq(bookings.shopId, params.shopId), refundDueSql));
  // お金の要確認：料金より多い入金・カード返金の結果待ち・チャージバック
  const [money] = await db
    .select({
      overpaid: sql<number>`count(*) filter (where ${overpaidSql})`.mapWith(Number),
      refundSending: sql<number>`count(*) filter (where ${refundSendingSql})`.mapWith(Number),
      dispute: sql<number>`count(*) filter (where ${disputeOpenSql})`.mapWith(Number),
    })
    .from(bookings)
    .innerJoin(payments, eq(payments.bookingId, bookings.id))
    .where(eq(bookings.shopId, params.shopId));
  // 事業者から中止・無断キャンセルの報告があり、組合がまだ状態を変えていない予約
  const [operatorReports] = await db
    .select({ count: count() })
    .from(bookings)
    .where(
      and(
        eq(bookings.shopId, params.shopId),
        eq(bookings.status, 'confirmed'),
        inArray(bookings.reportResult, ['cancelled', 'no_show']),
      ),
    );
  const [operatorResponded] = await db
    .select({ count: count() })
    .from(bookings)
    .where(and(eq(bookings.shopId, params.shopId), operatorRespondedSql));
  const counts = Object.fromEntries(byStatus.map((r) => [r.status, r.count])) as Partial<Record<BookingStatus, number>>;
  return {
    operatorResponded: operatorResponded?.count ?? 0,
    refundPending: refundPending?.count ?? 0,
    overpaid: money?.overpaid ?? 0,
    refundSending: money?.refundSending ?? 0,
    dispute: money?.dispute ?? 0,
    operatorReports: operatorReports?.count ?? 0,
    requested: counts.requested ?? 0,
    reviewing: counts.reviewing ?? 0,
    operatorChecking: counts.operator_checking ?? 0,
    awaitingPayment: counts.awaiting_payment ?? 0,
    paymentOverdue: overdue?.count ?? 0,
    paymentHeld: paymentHeld?.count ?? 0,
    awaitingReport: awaitingReport?.count ?? 0,
    awaitingVerification: counts.completed ?? 0,
  };
}

/** ある時刻以降に受け付けた申込の数（ダッシュボードの「今日の申込」。Web・電話などすべての経路） */
export async function countReceivedSince(db: DbOrTx, params: { shopId: string; since: Date }) {
  const [row] = await db
    .select({ count: count() })
    .from(bookings)
    .where(and(eq(bookings.shopId, params.shopId), gte(bookings.createdAt, params.since)));
  return row?.count ?? 0;
}

/** 未確定の申込（ダッシュボード用）。参加日の近い順（急ぐものから） */
export async function listOpenRequests(db: DbOrTx, params: { shopId: string; limit: number }) {
  return db
    .select({
      ...searchColumns,
      operatorResponded: operatorRespondedSql.mapWith(Boolean),
      // いちばん新しい回答の種類（受入可・条件付き・受入不可を色で分けるため）
      latestResponse: sql<'accepted' | 'conditional' | 'declined' | null>`(
        select r.status from ${bookingOperatorRequests} r
        where r.booking_id = ${bookings.id} and r.status in ('accepted', 'conditional', 'declined')
        order by (r.operator_id = ${bookings.operatorId}) desc nulls last, r.responded_at desc nulls last limit 1)`,
    })
    .from(bookings)
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .innerJoin(menus, eq(menus.id, slots.menuId))
    .innerJoin(
      menuTranslations,
      and(eq(menuTranslations.menuId, slots.menuId), eq(menuTranslations.locale, DEFAULT_LOCALE)),
    )
    .leftJoin(operators, eq(operators.id, bookings.operatorId))
    .leftJoin(payments, eq(payments.bookingId, bookings.id))
    .where(and(eq(bookings.shopId, params.shopId), inArray(bookings.status, [...OPEN_REQUEST_STATUSES])))
    .orderBy(asc(slots.startsAt), asc(bookings.createdAt))
    .limit(params.limit);
}

/** メニューの今後の有効な予約（申込〜確定）の件数（メニューをアーカイブするときの警告用） */
export async function countUpcomingBookings(db: DbOrTx, params: { menuId: string; now: Date }): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(bookings)
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .where(
      and(
        eq(slots.menuId, params.menuId),
        inArray(bookings.status, [...SEAT_HOLDING_STATUSES]),
        gte(slots.startsAt, params.now),
      ),
    );
  return row?.count ?? 0;
}

/** メニューに予約が 1 件でもあるか（定員の単位を変えられるかの判定用） */
export async function menuHasBookings(db: DbOrTx, menuId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .where(eq(slots.menuId, menuId))
    .limit(1);
  return Boolean(row);
}

/** 予約のメール送信履歴（管理画面の予約詳細用。新しい順） */
export async function listBookingNotifications(db: DbOrTx, params: { shopId: string; bookingId: string }) {
  return db
    .select({
      id: notifications.id,
      type: notifications.type,
      status: notifications.status,
      toEmail: notifications.toEmail,
      error: notifications.error,
      sentAt: notifications.sentAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(and(eq(notifications.shopId, params.shopId), eq(notifications.bookingId, params.bookingId)))
    .orderBy(desc(notifications.createdAt));
}
