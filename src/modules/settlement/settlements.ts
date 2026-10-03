import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, notInArray, or, sql } from 'drizzle-orm';
import type { Db, DbOrTx, Tx } from '@/db/client';
import {
  bookings,
  menuTranslations,
  operators,
  paymentRefunds,
  payments,
  settlementAdjustments,
  settlementItems,
  settlements,
  shops,
  slots,
} from '@/db/schema';
import { toCsv } from '@/lib/csv';
import { addMonths, localDate, monthOf, zonedToUtc } from '@/lib/dates';
import { isMonthString } from '@/lib/validation';
import { writeAuditLog } from '@/modules/audit/log';
import { changeBookingStatus } from '@/modules/booking/change-status';
import { FULL_REFUND_CANCEL_CATEGORIES } from '@/modules/booking/labels';
import { isPaymentReceived, type PaymentStatus } from '@/modules/booking/payment-status';
import { ENDED_STATUSES } from '@/modules/booking/status';
import { confirmedOnceSql } from '@/modules/booking/status-sql';
import { resolveSettings, type ShopSettings } from '@/modules/shop/settings';
import { lockSettlements } from './lock';
import { DEFAULT_LOCALE } from '@/lib/locale';

export type SettlementStatus = 'draft' | 'confirmed' | 'paid';
export type SettlementItemKind = 'activity' | 'onsite' | 'cancellation_fee';

export const SETTLEMENT_STATUS_LABELS: Record<SettlementStatus, string> = {
  draft: '下書き',
  confirmed: '確定（振込待ち）',
  paid: '振込済み',
};

/**
 * 精算の状態の名前。支払額がマイナスの月（現地払いの手数料が多く、事業者から組合へ払ってもらう）は、
 * 「振込」ではなく「入金」と書く
 */
export function settlementStatusLabel(status: SettlementStatus, payoutAmount: number): string {
  if (payoutAmount >= 0 || status === 'draft') return SETTLEMENT_STATUS_LABELS[status];
  return status === 'confirmed' ? '確定（入金待ち）' : '入金済み';
}

export const SETTLEMENT_ITEM_LABELS: Record<SettlementItemKind, string> = {
  activity: '実施',
  onsite: '実施（現地払い）',
  cancellation_fee: 'キャンセル料',
};

export const ADJUSTMENT_REASON_LABELS = {
  refund_after_payout: '精算の確定のあとの返金',
  payment_after_payout: '精算の確定のあとの入金（返金の取り消しを含む）',
  manual: '手での調整',
} as const;

export type SettlementErrorCode =
  | 'NOT_FOUND'
  | 'NOT_DRAFT'
  | 'NOT_CONFIRMED'
  | 'EMPTY'
  | 'INVALID_PERIOD'
  /** まだ締めていない月（今月・これからの月）は精算を作らない */
  | 'PERIOD_NOT_CLOSED'
  /** 画面で見た額と違う（ほかの画面で計算し直した・取り消したなど） */
  | 'CHANGED'
  | 'INVALID_DATE'
  | 'REASON_REQUIRED'
  /** 明細の予約に、カードへの返金の結果待ちがある（結果で精算の額が変わる） */
  | 'REFUND_PENDING';

export class SettlementError extends Error {
  constructor(readonly code: SettlementErrorCode) {
    super(code);
    this.name = 'SettlementError';
  }
}

export const SETTLEMENT_ERROR_LABELS: Record<SettlementErrorCode, string> = {
  NOT_FOUND: '精算が見つかりません。',
  NOT_DRAFT: '下書きの精算だけ、確定・計算し直しができます。',
  NOT_CONFIRMED: '確定した精算だけ、振込の記録・確定の取り消しができます。',
  EMPTY: '明細のない精算は確定できません。',
  INVALID_PERIOD: '精算の月が正しくありません。',
  PERIOD_NOT_CLOSED: 'まだ締めていない月（今月・これからの月）の精算は作れません。月が終わってから作ってください。',
  CHANGED:
    '画面を開いたあとに、ほかの画面で精算が変わりました。画面を開き直して、金額を確かめてからもう一度押してください。',
  INVALID_DATE: '振込日・入金日は、確定した日から今日までの日付を入れてください。',
  REASON_REQUIRED: '確定を取り消す理由を入れてください（事業者画面から明細が消えるため、記録に残します）。',
  REFUND_PENDING:
    '明細の予約に、カードへの返金の結果待ちがあります。予約の詳細の「Stripe に確かめる」で結果を決めてから、もう一度押してください（結果で精算の額が変わるため）。',
};

/** 精算の月の終わり（翌月 1 日 0:00。ショップのタイムゾーン） */
function periodEnd(period: string, timezone: string): Date {
  return zonedToUtc(`${addMonths(period, 1)}-01`, '00:00', timezone);
}

/** 締めた月か（ショップのタイムゾーンで今月より前）。締めていない月の精算は作らない（月末締め） */
export function isClosedPeriod(period: string, now: Date, timezone: string): boolean {
  return period < monthOf(localDate(now, timezone));
}

/** 事業者への支払日（締めた翌月の payoutDay 日。0 は末日）。YYYY-MM-DD */
export function payoutDateOf(period: string, payoutDay: number): string {
  const next = addMonths(period, 1);
  const [y, m] = next.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const day = payoutDay === 0 ? last : Math.min(payoutDay, last);
  return `${next}-${String(day).padStart(2, '0')}`;
}

/**
 * 手数料（対象額 × 率 ÷ 100 を四捨五入）。率は 0.1 刻みなので 10 倍の整数にして整数だけで計算する
 * （浮動小数の誤差で .5 が切り捨てられて 1 円ずれないように）
 */
export function commissionOf(gross: number, rate: number): number {
  const r10 = Math.round(rate * 10);
  const sign = gross < 0 ? -1 : 1;
  return sign * Math.floor((Math.abs(gross) * r10 + 500) / 1000);
}

export type Candidate = {
  bookingId: string;
  operatorId: string;
  status: string;
  paymentMethod: 'online' | 'onsite';
  totalAmount: number;
  paymentStatus: PaymentStatus | null;
  paymentAmount: number | null;
  refundedAmount: number | null;
  refundDueAmount: number | null;
  /** 取消の区分（組合・事業者の都合の取消は、キャンセル料を事業者に払わない） */
  cancelCategory?: string | null;
  /** 取消のときの「キャンセル料は事業者の取り分」（null は古い取消。今の設定を使う） */
  cancellationFeeToOperator?: boolean | null;
};

/** 精算の明細 1 行（受け取り・返金・対象額・手数料・支払額。円） */
export type SettlementLine = {
  kind: SettlementItemKind;
  paid: number;
  refund: number;
  gross: number;
  commission: number;
  payout: number;
};

/** 予約 1 件の明細（精算に入れないときは null）。手数料は 1 件ごとに四捨五入する */
export function settlementLine(
  c: Candidate,
  settings: Pick<ShopSettings, 'commissionRate' | 'cancellationFeeToOperator'>,
): SettlementLine | null {
  const rate = settings.commissionRate;
  const received = isPaymentReceived(c.paymentStatus);
  if (c.status === 'verified') {
    if (c.paymentMethod === 'onsite') {
      // 現地払い：事業者がお客様から受け取っているので、手数料を組合へ払ってもらう
      const commission = commissionOf(c.totalAmount, rate);
      return { kind: 'onsite', paid: c.totalAmount, refund: 0, gross: c.totalAmount, commission, payout: -commission };
    }
    if (!received) return null;
    const paid = c.paymentAmount ?? 0;
    const refund = c.refundedAmount ?? 0;
    // 料金を超えて受け取った分（二重のお支払いなど。お客様に返す）は、事業者に払わない
    const gross = Math.min(Math.max(0, paid - refund), c.totalAmount);
    const commission = commissionOf(gross, rate);
    return { kind: 'activity', paid, refund, gross, commission, payout: gross - commission };
  }
  // 確定後の取消・天候中止・無断キャンセル：返さない額（キャンセル料）。事前払いで組合が受け取ったものだけ。
  // 事業者に払うかは、取消のときの設定（古い取消は今の設定）
  const toOperator = c.cancellationFeeToOperator ?? settings.cancellationFeeToOperator;
  if (!received || !toOperator) return null;
  // 組合・事業者の都合の取消は全額を返すので入れない（返し残しがあっても事業者には払わない）
  if (c.cancelCategory && (FULL_REFUND_CANCEL_CATEGORIES as readonly string[]).includes(c.cancelCategory)) return null;
  const paid = c.paymentAmount ?? 0;
  const refund = Math.max(c.refundDueAmount ?? 0, c.refundedAmount ?? 0);
  const gross = Math.max(0, paid - refund);
  if (gross === 0) return null;
  const commission = commissionOf(gross, rate);
  return { kind: 'cancellation_fee', paid, refund, gross, commission, payout: gross - commission };
}

/** 精算の計算の結果。実績の確認がまだの予約は、催行報告待ちと実績確認待ちに分けて数える */
export type BuildResult = {
  drafts: number;
  awaitingReport: number;
  awaitingVerification: number;
  /** ほかの月の下書きからこの月へ移した予約の数 */
  moved: number;
};

const candidateColumns = {
  bookingId: bookings.id,
  operatorId: bookings.operatorId,
  status: bookings.status,
  paymentMethod: bookings.paymentMethod,
  totalAmount: bookings.totalAmount,
  paymentStatus: payments.status,
  paymentAmount: payments.amount,
  refundedAmount: payments.refundedAmount,
  refundDueAmount: payments.refundDueAmount,
  cancelCategory: bookings.cancelCategory,
  cancellationFeeToOperator: bookings.cancellationFeeToOperator,
  startsAt: slots.startsAt,
};

/** 下書きの合計を、明細と調整から計算し直す（明細も調整もなくなったら下書きを消す） */
async function recomputeDraft(tx: Tx, settlementId: string): Promise<void> {
  const [lines] = await tx
    .select({
      count: sql<number>`count(*)`.mapWith(Number),
      gross: sql<number>`coalesce(sum(${settlementItems.grossAmount}), 0)`.mapWith(Number),
      commission: sql<number>`coalesce(sum(${settlementItems.commissionAmount}), 0)`.mapWith(Number),
      payout: sql<number>`coalesce(sum(${settlementItems.payoutAmount}), 0)`.mapWith(Number),
    })
    .from(settlementItems)
    .where(eq(settlementItems.settlementId, settlementId));
  const [adjust] = await tx
    .select({
      count: sql<number>`count(*)`.mapWith(Number),
      gross: sql<number>`coalesce(sum(${settlementAdjustments.grossDelta}), 0)`.mapWith(Number),
      commission: sql<number>`coalesce(sum(${settlementAdjustments.commissionDelta}), 0)`.mapWith(Number),
      payout: sql<number>`coalesce(sum(${settlementAdjustments.payoutDelta}), 0)`.mapWith(Number),
    })
    .from(settlementAdjustments)
    .where(eq(settlementAdjustments.settlementId, settlementId));
  if (lines.count === 0 && adjust.count === 0) {
    await tx.delete(settlements).where(eq(settlements.id, settlementId));
    return;
  }
  await tx
    .update(settlements)
    .set({
      grossAmount: lines.gross + adjust.gross,
      commissionAmount: lines.commission + adjust.commission,
      payoutAmount: lines.payout + adjust.payout,
      updatedAt: sql`now()`,
    })
    .where(eq(settlements.id, settlementId));
}

/**
 * 月の下書きを作り直す（トランザクションの中で、lockSettlements のあとに呼ぶ）。
 * 予約は「参加日の月」の精算に入れる。その事業者のその月の精算が確定・振込済みなら、確定していない次の月へ回す
 * （作る順番によらず、入れそびれた予約も必ずどこかの精算に入る）。ほかの月の下書きにあった予約は、この月へ移す。
 * 振込のあとの返金・追加の入金の調整（まだどの精算にも入っていないもの）も、この月の下書きに入れる
 */
async function rebuildDrafts(tx: Tx, params: { shopId: string; period: string; actorId: string | null }) {
  const [shop] = await tx
    .select({ timezone: shops.timezone, settings: shops.settings })
    .from(shops)
    .where(eq(shops.id, params.shopId));
  const settings = resolveSettings(shop.settings);
  const end = periodEnd(params.period, shop.timezone);
  // 運用を始めた月より前の予約は精算に入れない（それまでの分は別に精算済み）
  const start = settings.settlementStartMonth
    ? zonedToUtc(`${settings.settlementStartMonth}-01`, '00:00', shop.timezone)
    : null;

  const locked = await tx
    .select({ operatorId: settlements.operatorId, period: settlements.period })
    .from(settlements)
    .where(and(eq(settlements.shopId, params.shopId), ne(settlements.status, 'draft')));
  const lockedKeys = new Set(locked.map((l) => `${l.operatorId}:${l.period}`));
  /** 予約を入れる月：参加日の月から、確定・振込済みでない最初の月 */
  const targetPeriod = (operatorId: string, startsAt: Date) => {
    let period = monthOf(localDate(startsAt, shop.timezone));
    while (lockedKeys.has(`${operatorId}:${period}`)) period = addMonths(period, 1);
    return period;
  };

  // 確定・振込済みの精算に入っている予約は除く
  const taken = tx
    .select({ id: settlementItems.bookingId })
    .from(settlementItems)
    .innerJoin(settlements, eq(settlements.id, settlementItems.settlementId))
    .where(and(eq(settlements.shopId, params.shopId), ne(settlements.status, 'draft')));
  const confirmedOnce = confirmedOnceSql;
  const rows = await tx
    .select(candidateColumns)
    .from(bookings)
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .leftJoin(payments, eq(payments.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.shopId, params.shopId),
        lt(slots.startsAt, end),
        start ? gte(slots.startsAt, start) : undefined,
        notInArray(bookings.id, taken),
        or(eq(bookings.status, 'verified'), and(inArray(bookings.status, ENDED_STATUSES), confirmedOnce)),
      ),
    )
    .orderBy(asc(slots.startsAt));
  // 実施事業者のいない予約は精算しない（催行のあとは DB の制約で必ずいる。確定後の取消で外したものだけ）
  const candidates = rows.flatMap((r) =>
    r.operatorId && targetPeriod(r.operatorId, r.startsAt) === params.period
      ? [{ ...r, operatorId: r.operatorId } satisfies Candidate & { startsAt: Date }]
      : [],
  );
  const pending = await tx
    .select({ status: bookings.status, count: sql<number>`count(*)`.mapWith(Number) })
    .from(bookings)
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .where(
      and(
        eq(bookings.shopId, params.shopId),
        lt(slots.startsAt, end),
        inArray(bookings.status, ['confirmed', 'completed']),
      ),
    )
    .groupBy(bookings.status);
  const countOf = (status: string) => pending.find((p) => p.status === status)?.count ?? 0;

  const byOperator = new Map<string, { candidate: Candidate; line: SettlementLine }[]>();
  for (const candidate of candidates) {
    const line = settlementLine(candidate, settings);
    if (!line) continue;
    const list = byOperator.get(candidate.operatorId) ?? [];
    list.push({ candidate, line });
    byOperator.set(candidate.operatorId, list);
  }

  // ほかの月の下書きにある、この月に入れる予約を移す（移したもとの下書きは計算し直す）
  const bookingIds = [...byOperator.values()].flat().map((l) => l.candidate.bookingId);
  let moved = 0;
  if (bookingIds.length > 0) {
    const elsewhere = await tx
      .select({ itemId: settlementItems.id, settlementId: settlementItems.settlementId })
      .from(settlementItems)
      .innerJoin(settlements, eq(settlements.id, settlementItems.settlementId))
      .where(
        and(
          inArray(settlementItems.bookingId, bookingIds),
          eq(settlements.status, 'draft'),
          ne(settlements.period, params.period),
        ),
      );
    if (elsewhere.length > 0) {
      moved = elsewhere.length;
      await tx.delete(settlementItems).where(
        inArray(
          settlementItems.id,
          elsewhere.map((e) => e.itemId),
        ),
      );
      for (const id of new Set(elsewhere.map((e) => e.settlementId))) await recomputeDraft(tx, id);
    }
  }

  // この月の下書き：調整を外し、明細を消してから作り直す（確定・振込済みの事業者はそのまま）
  const existing = await tx
    .select({ id: settlements.id, operatorId: settlements.operatorId, status: settlements.status })
    .from(settlements)
    .where(and(eq(settlements.shopId, params.shopId), eq(settlements.period, params.period)));
  const drafts = existing.filter((s) => s.status === 'draft');
  if (drafts.length > 0) {
    const ids = drafts.map((d) => d.id);
    await tx
      .update(settlementAdjustments)
      .set({ settlementId: null })
      .where(inArray(settlementAdjustments.settlementId, ids));
    await tx.delete(settlementItems).where(inArray(settlementItems.settlementId, ids));
  }
  // まだどの精算にも入っていない調整（この月の終わりより前にできたもの）
  const adjustments = await tx
    .select({ id: settlementAdjustments.id, operatorId: settlementAdjustments.operatorId })
    .from(settlementAdjustments)
    .where(
      and(
        eq(settlementAdjustments.shopId, params.shopId),
        isNull(settlementAdjustments.settlementId),
        lt(settlementAdjustments.createdAt, end),
      ),
    );

  const operatorIds = new Set([...byOperator.keys(), ...adjustments.map((a) => a.operatorId)]);
  let count = 0;
  for (const operatorId of operatorIds) {
    if (lockedKeys.has(`${operatorId}:${params.period}`)) continue;
    const draft = drafts.find((d) => d.operatorId === operatorId);
    let settlementId: string;
    if (draft) {
      settlementId = draft.id;
      await tx
        .update(settlements)
        .set({ commissionRate: settings.commissionRate, updatedAt: sql`now()` })
        .where(eq(settlements.id, draft.id));
    } else {
      const [row] = await tx
        .insert(settlements)
        .values({ shopId: params.shopId, operatorId, period: params.period, commissionRate: settings.commissionRate })
        .returning({ id: settlements.id });
      settlementId = row.id;
    }
    const lines = byOperator.get(operatorId) ?? [];
    if (lines.length > 0) {
      await tx.insert(settlementItems).values(
        lines.map(({ candidate, line }) => ({
          settlementId,
          bookingId: candidate.bookingId,
          kind: line.kind,
          paidAmount: line.paid,
          refundAmount: line.refund,
          grossAmount: line.gross,
          commissionAmount: line.commission,
          payoutAmount: line.payout,
        })),
      );
    }
    const mine = adjustments.filter((a) => a.operatorId === operatorId).map((a) => a.id);
    if (mine.length > 0) {
      await tx.update(settlementAdjustments).set({ settlementId }).where(inArray(settlementAdjustments.id, mine));
    }
    await recomputeDraft(tx, settlementId);
    count++;
  }
  // 明細も調整もなくなった下書きは消す
  for (const draft of drafts) {
    if (!operatorIds.has(draft.operatorId)) await tx.delete(settlements).where(eq(settlements.id, draft.id));
  }
  const result: BuildResult = {
    drafts: count,
    awaitingReport: countOf('confirmed'),
    awaitingVerification: countOf('completed'),
    moved,
  };
  await writeAuditLog(tx, {
    shopId: params.shopId,
    actorId: params.actorId,
    action: 'settlement.build',
    targetType: 'settlement_period',
    targetId: params.period,
    after: result,
  });
  return result;
}

/** 月の精算（下書き）を作る・計算し直す。締めた月だけ */
export async function buildSettlements(
  db: Db,
  params: { shopId: string; period: string; actorId: string | null; now: Date },
): Promise<BuildResult> {
  if (!isMonthString(params.period)) throw new SettlementError('INVALID_PERIOD');
  return db.transaction(async (tx) => {
    await lockSettlements(tx, params.shopId);
    const timezone = await shopTimezone(tx, params.shopId);
    if (!isClosedPeriod(params.period, params.now, timezone)) throw new SettlementError('PERIOD_NOT_CLOSED');
    return rebuildDrafts(tx, params);
  });
}

async function shopTimezone(tx: DbOrTx, shopId: string): Promise<string> {
  const [shop] = await tx.select({ timezone: shops.timezone }).from(shops).where(eq(shops.id, shopId));
  return shop.timezone;
}

async function findSettlement(db: DbOrTx, shopId: string, id: string) {
  const [row] = await db
    .select()
    .from(settlements)
    .where(and(eq(settlements.id, id), eq(settlements.shopId, shopId)));
  if (!row) throw new SettlementError('NOT_FOUND');
  return row;
}

/** 精算の明細と調整のいま（確定・取り消しの記録に残す） */
async function snapshotOf(tx: Tx, settlementId: string) {
  const [items, adjustments] = await Promise.all([
    tx
      .select({
        bookingId: settlementItems.bookingId,
        kind: settlementItems.kind,
        paid: settlementItems.paidAmount,
        refund: settlementItems.refundAmount,
        gross: settlementItems.grossAmount,
        commission: settlementItems.commissionAmount,
        payout: settlementItems.payoutAmount,
      })
      .from(settlementItems)
      .where(eq(settlementItems.settlementId, settlementId)),
    tx
      .select({
        id: settlementAdjustments.id,
        bookingId: settlementAdjustments.bookingId,
        reason: settlementAdjustments.reason,
        payout: settlementAdjustments.payoutDelta,
      })
      .from(settlementAdjustments)
      .where(eq(settlementAdjustments.settlementId, settlementId)),
  ]);
  return { items, adjustments };
}

/** 画面で見た精算（確定・振込の記録で、見たときから変わっていないかを確かめる） */
export type SeenSettlement = { payoutAmount: number; itemCount: number; adjustmentCount: number };

/**
 * 精算を確定する（事業者画面に明細を出す。確定すると計算し直さない）。確定の前にその月の下書きを計算し直し、
 * 画面で見た額・件数と違えば確定せずに 'changed' を返す（下書きを作ったあとの返金・実績の確認を入れ漏らさない）。
 * 支払日と組合の登録番号は確定の時点の設定で残し、確定した明細の内容を記録に残す
 */
export async function confirmSettlement(
  db: Db,
  params: { shopId: string; id: string; actorId: string | null; now: Date; seen: SeenSettlement },
): Promise<{ result: 'confirmed' | 'changed' | 'removed'; period: string }> {
  return db.transaction(async (tx) => {
    await lockSettlements(tx, params.shopId);
    const before = await findSettlement(tx, params.shopId, params.id);
    if (before.status !== 'draft') throw new SettlementError('NOT_DRAFT');
    const [shop] = await tx
      .select({ timezone: shops.timezone, settings: shops.settings })
      .from(shops)
      .where(eq(shops.id, params.shopId));
    if (!isClosedPeriod(before.period, params.now, shop.timezone)) throw new SettlementError('PERIOD_NOT_CLOSED');
    await rebuildDrafts(tx, { shopId: params.shopId, period: before.period, actorId: params.actorId });
    const [row] = await tx
      .select()
      .from(settlements)
      .where(and(eq(settlements.id, before.id), eq(settlements.shopId, params.shopId)));
    // 計算し直して明細がなくなった（下書きが消えた）
    if (!row) return { result: 'removed', period: before.period };
    const snapshot = await snapshotOf(tx, row.id);
    if (snapshot.items.length === 0 && snapshot.adjustments.length === 0) throw new SettlementError('EMPTY');
    if (await hasPendingRefund(tx, row.id)) throw new SettlementError('REFUND_PENDING');
    if (
      row.payoutAmount !== params.seen.payoutAmount ||
      snapshot.items.length !== params.seen.itemCount ||
      snapshot.adjustments.length !== params.seen.adjustmentCount
    ) {
      return { result: 'changed', period: row.period };
    }
    const settings = resolveSettings(shop.settings);
    const payoutOn = payoutDateOf(row.period, settings.payoutDay);
    await tx
      .update(settlements)
      .set({
        status: 'confirmed',
        confirmedAt: sql`now()`,
        confirmedBy: params.actorId,
        payoutOn,
        shopInvoiceNumber: settings.invoiceNumber,
        updatedAt: sql`now()`,
      })
      .where(eq(settlements.id, row.id));
    await writeAuditLog(tx, {
      shopId: params.shopId,
      actorId: params.actorId,
      action: 'settlement.confirm',
      targetType: 'settlement',
      targetId: row.id,
      after: {
        commissionRate: row.commissionRate,
        grossAmount: row.grossAmount,
        commissionAmount: row.commissionAmount,
        payoutAmount: row.payoutAmount,
        payoutOn,
        shopInvoiceNumber: settings.invoiceNumber,
        ...snapshot,
      },
    });
    return { result: 'confirmed', period: row.period };
  });
}

/** 確定を取り消して下書きに戻す（振込の前だけ。理由は必須。確定していた内容を記録に残す） */
export async function unconfirmSettlement(
  db: Db,
  params: { shopId: string; id: string; actorId: string | null; reason: string },
) {
  const reason = params.reason.trim();
  if (!reason) throw new SettlementError('REASON_REQUIRED');
  await db.transaction(async (tx) => {
    await lockSettlements(tx, params.shopId);
    const row = await findSettlement(tx, params.shopId, params.id);
    if (row.status !== 'confirmed') throw new SettlementError('NOT_CONFIRMED');
    const snapshot = await snapshotOf(tx, row.id);
    await tx
      .update(settlements)
      .set({
        status: 'draft',
        confirmedAt: null,
        confirmedBy: null,
        payoutOn: null,
        shopInvoiceNumber: null,
        updatedAt: sql`now()`,
      })
      .where(eq(settlements.id, row.id));
    await writeAuditLog(tx, {
      shopId: params.shopId,
      actorId: params.actorId,
      action: 'settlement.unconfirm',
      targetType: 'settlement',
      targetId: row.id,
      before: {
        confirmedAt: row.confirmedAt,
        confirmedBy: row.confirmedBy,
        payoutOn: row.payoutOn,
        payoutAmount: row.payoutAmount,
        commissionRate: row.commissionRate,
        ...snapshot,
      },
      after: { reason },
    });
  });
}

/**
 * 振込を記録する。画面で見た支払額のときだけ（ほかの画面で確定し直していたら止める）。
 * 振込日は確定した日から今日まで。実績確認済みの予約を「精算済み」にする
 */
export async function markSettlementPaid(
  db: Db,
  params: {
    shopId: string;
    id: string;
    actorId: string | null;
    paidAt: Date;
    note: string;
    now: Date;
    seenPayoutAmount: number;
  },
) {
  await db.transaction(async (tx) => {
    await lockSettlements(tx, params.shopId);
    const row = await findSettlement(tx, params.shopId, params.id);
    if (row.status !== 'confirmed') throw new SettlementError('NOT_CONFIRMED');
    if (row.payoutAmount !== params.seenPayoutAmount) throw new SettlementError('CHANGED');
    const timezone = await shopTimezone(tx, params.shopId);
    const paidOn = localDate(params.paidAt, timezone);
    if (
      paidOn > localDate(params.now, timezone) ||
      (row.confirmedAt && paidOn < localDate(row.confirmedAt, timezone))
    ) {
      throw new SettlementError('INVALID_DATE');
    }
    if (await hasPendingRefund(tx, row.id)) throw new SettlementError('REFUND_PENDING');
    const items = await tx
      .select({ bookingId: settlementItems.bookingId, status: bookings.status })
      .from(settlementItems)
      .innerJoin(bookings, eq(bookings.id, settlementItems.bookingId))
      .where(eq(settlementItems.settlementId, row.id));
    for (const item of items) {
      if (item.status !== 'verified') continue;
      await changeBookingStatus(tx, {
        shopId: params.shopId,
        bookingId: item.bookingId,
        to: 'settled',
        actor: { type: 'staff', id: params.actorId },
        note: `月次精算（${row.period}）の振込を記録`,
        now: params.now,
        fromSettlement: true,
      });
    }
    await tx
      .update(settlements)
      .set({
        status: 'paid',
        paidAt: params.paidAt,
        paidBy: params.actorId,
        paidNote: params.note.trim(),
        updatedAt: sql`now()`,
      })
      .where(eq(settlements.id, row.id));
    await writeAuditLog(tx, {
      shopId: params.shopId,
      actorId: params.actorId,
      action: 'settlement.paid',
      targetType: 'settlement',
      targetId: row.id,
      after: { paidAt: params.paidAt.toISOString(), payoutAmount: row.payoutAmount, note: params.note.trim() },
    });
    // 確定のあとにお金が変わった予約（Webhook での返金・チャージバック・返金の取り消しなど）は、振込はこの額のまま、
    // 今の台帳との差を次の精算の調整にする（確定してから振込までの間の変化を取りこぼさない）
    for (const item of items) {
      await recordPayoutAdjustment(tx, {
        shopId: params.shopId,
        bookingId: item.bookingId,
        reason: 'auto',
        actorId: params.actorId,
      });
    }
  });
}

/** 精算の明細の予約に、カードへの返金の結果待ちがあるか */
async function hasPendingRefund(tx: Tx, settlementId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: paymentRefunds.id })
    .from(settlementItems)
    .innerJoin(payments, eq(payments.bookingId, settlementItems.bookingId))
    .innerJoin(paymentRefunds, and(eq(paymentRefunds.paymentId, payments.id), eq(paymentRefunds.status, 'pending')))
    .where(eq(settlementItems.settlementId, settlementId))
    .limit(1);
  return Boolean(row);
}

/**
 * 振込済みの精算に入った予約のお金が、あとから変わったとき（返金・追加の入金）の調整を作る
 * （トランザクションの中で、精算のロックと支払いの行ロックのあとに呼ぶ）。
 * 今の支払いを元の精算の率で計算し直し、「元の明細＋それまでの調整」との差を 1 行にする（差がなければ作らない）
 */
export async function recordPayoutAdjustment(
  tx: Tx,
  params: {
    shopId: string;
    bookingId: string;
    /** auto：差の向き（支払額が減ったら返金、増えたら入金）で決める */
    reason: 'refund_after_payout' | 'payment_after_payout' | 'auto';
    actorId: string | null;
    note?: string;
  },
): Promise<{ payoutDelta: number; period: string } | null> {
  const [origin] = await tx
    .select({
      itemId: settlementItems.id,
      kind: settlementItems.kind,
      gross: settlementItems.grossAmount,
      commission: settlementItems.commissionAmount,
      payout: settlementItems.payoutAmount,
      rate: settlements.commissionRate,
      operatorId: settlements.operatorId,
      period: settlements.period,
    })
    .from(settlementItems)
    .innerJoin(settlements, eq(settlements.id, settlementItems.settlementId))
    .where(
      and(
        eq(settlementItems.bookingId, params.bookingId),
        eq(settlements.shopId, params.shopId),
        eq(settlements.status, 'paid'),
      ),
    );
  if (!origin) return null;
  const [current] = await tx
    .select(candidateColumns)
    .from(bookings)
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .leftJoin(payments, eq(payments.bookingId, bookings.id))
    .where(eq(bookings.id, params.bookingId));
  // 振込のあとは予約が「精算済み」になっているので、明細を作ったときの区分で計算し直す
  const asCandidate: Candidate = {
    ...current,
    operatorId: origin.operatorId,
    status: origin.kind === 'cancellation_fee' ? 'cancelled' : 'verified',
    cancellationFeeToOperator: true,
  };
  const line = settlementLine(asCandidate, { commissionRate: origin.rate, cancellationFeeToOperator: true });
  const [prev] = await tx
    .select({
      gross: sql<number>`coalesce(sum(${settlementAdjustments.grossDelta}), 0)`.mapWith(Number),
      commission: sql<number>`coalesce(sum(${settlementAdjustments.commissionDelta}), 0)`.mapWith(Number),
    })
    .from(settlementAdjustments)
    .where(eq(settlementAdjustments.bookingId, params.bookingId));
  const grossDelta = (line?.gross ?? 0) - (origin.gross + prev.gross);
  const commissionDelta = (line?.commission ?? 0) - (origin.commission + prev.commission);
  if (grossDelta === 0 && commissionDelta === 0) return null;
  const payoutDelta = grossDelta - commissionDelta;
  const reason =
    params.reason === 'auto' ? (payoutDelta < 0 ? 'refund_after_payout' : 'payment_after_payout') : params.reason;
  await tx.insert(settlementAdjustments).values({
    shopId: params.shopId,
    operatorId: origin.operatorId,
    bookingId: params.bookingId,
    originItemId: origin.itemId,
    reason,
    commissionRate: origin.rate,
    grossDelta,
    commissionDelta,
    payoutDelta,
    note: params.note?.trim() ?? '',
    createdBy: params.actorId,
  });
  await writeAuditLog(tx, {
    shopId: params.shopId,
    actorId: params.actorId,
    action: 'settlement.adjustment',
    targetType: 'booking',
    targetId: params.bookingId,
    after: { reason, period: origin.period, grossDelta, commissionDelta, payoutDelta },
  });
  return { payoutDelta, period: origin.period };
}

const settlementColumns = {
  id: settlements.id,
  operatorId: settlements.operatorId,
  operatorName: operators.name,
  period: settlements.period,
  status: settlements.status,
  commissionRate: settlements.commissionRate,
  grossAmount: settlements.grossAmount,
  commissionAmount: settlements.commissionAmount,
  payoutAmount: settlements.payoutAmount,
  confirmedAt: settlements.confirmedAt,
  payoutOn: settlements.payoutOn,
  shopInvoiceNumber: settlements.shopInvoiceNumber,
  paidAt: settlements.paidAt,
  paidNote: settlements.paidNote,
  updatedAt: settlements.updatedAt,
  itemCount: sql<number>`(select count(*) from ${settlementItems} i where i.settlement_id = ${settlements.id})`.mapWith(
    Number,
  ),
  adjustmentCount:
    sql<number>`(select count(*) from ${settlementAdjustments} a where a.settlement_id = ${settlements.id})`.mapWith(
      Number,
    ),
};

/** 月の精算の一覧（組合） */
/**
 * 精算を作る前に知らせる、まだ精算に入れられない予約の数（参加日がこの月までで、催行報告待ち・実績確認待ちのもの）。
 * 数え方は精算を作るとき（rebuildDrafts）と同じ。operatorId を渡すと、その事業者の予約だけを数える。
 * firstDate は、その中でいちばん早い参加日（予約台帳を同じ範囲で開くリンクに使う。ショップのタイムゾーンの日付）
 */
export async function countAwaitingSettlement(
  db: DbOrTx,
  params: { shopId: string; period: string; operatorId?: string },
): Promise<{ awaitingReport: number; awaitingVerification: number; firstDate: string | null }> {
  const timezone = await shopTimezone(db, params.shopId);
  const end = periodEnd(params.period, timezone);
  const rows = await db
    .select({
      status: bookings.status,
      count: sql<number>`count(*)`.mapWith(Number),
      first: sql<Date>`min(${slots.startsAt})`.mapWith((v: string | Date) => new Date(v)),
    })
    .from(bookings)
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .where(
      and(
        eq(bookings.shopId, params.shopId),
        lt(slots.startsAt, end),
        inArray(bookings.status, ['confirmed', 'completed']),
        params.operatorId ? eq(bookings.operatorId, params.operatorId) : undefined,
      ),
    )
    .groupBy(bookings.status);
  const countOf = (status: string) => rows.find((r) => r.status === status)?.count ?? 0;
  const first = rows.reduce<Date | null>((min, r) => (!min || r.first < min ? r.first : min), null);
  return {
    awaitingReport: countOf('confirmed'),
    awaitingVerification: countOf('completed'),
    firstDate: first ? localDate(first, timezone) : null,
  };
}

/** 精算口座（振込先）をまだ登録していない事業者（確定の前に知らせるため。渡した事業者の中から返す） */
export async function listOperatorsWithoutBankAccount(
  db: DbOrTx,
  params: { shopId: string; operatorIds: string[] },
): Promise<{ id: string; name: string }[]> {
  if (params.operatorIds.length === 0) return [];
  return db
    .select({ id: operators.id, name: operators.name })
    .from(operators)
    .where(
      and(
        eq(operators.shopId, params.shopId),
        inArray(operators.id, params.operatorIds),
        sql`trim(${operators.bankAccount}) = ''`,
      ),
    )
    .orderBy(asc(operators.sortOrder), asc(operators.name));
}

export async function listSettlements(db: DbOrTx, params: { shopId: string; period: string }) {
  return db
    .select(settlementColumns)
    .from(settlements)
    .innerJoin(operators, eq(operators.id, settlements.operatorId))
    .where(and(eq(settlements.shopId, params.shopId), eq(settlements.period, params.period)))
    .orderBy(asc(operators.sortOrder), asc(operators.name));
}

/** 精算の明細（予約 1 件ごと）。複数の精算の分をまとめて取れる */
async function listItems(db: DbOrTx, settlementIds: string[]) {
  if (settlementIds.length === 0) return [];
  return db
    .select({
      settlementId: settlementItems.settlementId,
      id: settlementItems.id,
      bookingId: settlementItems.bookingId,
      kind: settlementItems.kind,
      paidAmount: settlementItems.paidAmount,
      refundAmount: settlementItems.refundAmount,
      grossAmount: settlementItems.grossAmount,
      commissionAmount: settlementItems.commissionAmount,
      payoutAmount: settlementItems.payoutAmount,
      bookingNo: bookings.bookingNo,
      bookingStatus: bookings.status,
      partySize: bookings.partySize,
      startsAt: slots.startsAt,
      menuTitle: menuTranslations.title,
    })
    .from(settlementItems)
    .innerJoin(bookings, eq(bookings.id, settlementItems.bookingId))
    .innerJoin(slots, eq(slots.id, bookings.slotId))
    .innerJoin(
      menuTranslations,
      and(eq(menuTranslations.menuId, slots.menuId), eq(menuTranslations.locale, DEFAULT_LOCALE)),
    )
    .where(inArray(settlementItems.settlementId, settlementIds))
    .orderBy(asc(slots.startsAt));
}

/** 精算に入れた調整（前の精算の振込のあとの返金・追加の入金） */
async function listAdjustments(db: DbOrTx, settlementIds: string[]) {
  if (settlementIds.length === 0) return [];
  return db
    .select({
      settlementId: settlementAdjustments.settlementId,
      id: settlementAdjustments.id,
      bookingId: settlementAdjustments.bookingId,
      reason: settlementAdjustments.reason,
      grossDelta: settlementAdjustments.grossDelta,
      commissionDelta: settlementAdjustments.commissionDelta,
      payoutDelta: settlementAdjustments.payoutDelta,
      createdAt: settlementAdjustments.createdAt,
      bookingNo: bookings.bookingNo,
      originPeriod: sql<string>`(select s.period from ${settlementItems} i join ${settlements} s on s.id = i.settlement_id where i.id = ${settlementAdjustments.originItemId})`,
    })
    .from(settlementAdjustments)
    .innerJoin(bookings, eq(bookings.id, settlementAdjustments.bookingId))
    .where(inArray(settlementAdjustments.settlementId, settlementIds))
    .orderBy(asc(settlementAdjustments.createdAt));
}

async function withDetails<T extends { id: string }>(db: DbOrTx, rows: T[]) {
  const ids = rows.map((r) => r.id);
  const [items, adjustments] = await Promise.all([listItems(db, ids), listAdjustments(db, ids)]);
  return rows.map((row) => ({
    ...row,
    items: items.filter((i) => i.settlementId === row.id),
    adjustments: adjustments.filter((a) => a.settlementId === row.id),
  }));
}

/** 精算 1 件と明細（組合） */
export async function getSettlement(db: DbOrTx, params: { shopId: string; id: string }) {
  const rows = await db
    .select(settlementColumns)
    .from(settlements)
    .innerJoin(operators, eq(operators.id, settlements.operatorId))
    .where(and(eq(settlements.id, params.id), eq(settlements.shopId, params.shopId)));
  return (await withDetails(db, rows))[0] ?? null;
}

/** 予約が入っている精算と明細の区分（入っていなければ null）。返金の前に、確定した精算に入っていないかを見る */
export async function getBookingSettlement(db: DbOrTx, params: { shopId: string; bookingId: string }) {
  const [row] = await db
    .select({ id: settlements.id, status: settlements.status, period: settlements.period, kind: settlementItems.kind })
    .from(settlementItems)
    .innerJoin(settlements, eq(settlements.id, settlementItems.settlementId))
    .where(and(eq(settlementItems.bookingId, params.bookingId), eq(settlements.shopId, params.shopId)));
  return row ?? null;
}

/** 月の精算と明細をまとめて（組合の CSV 用。精算の数によらず問い合わせは 3 回） */
export async function listSettlementDetails(db: DbOrTx, params: { shopId: string; period: string }) {
  return withDetails(db, await listSettlements(db, params));
}

/** 事業者の精算の一覧（確定・振込済みだけ。下書きは見せない） */
export async function listOperatorSettlements(db: DbOrTx, params: { operatorId: string }) {
  return db
    .select(settlementColumns)
    .from(settlements)
    .innerJoin(operators, eq(operators.id, settlements.operatorId))
    .where(and(eq(settlements.operatorId, params.operatorId), ne(settlements.status, 'draft')))
    .orderBy(desc(settlements.period));
}

/** 事業者の精算 1 件と明細（自社の確定・振込済みだけ） */
export async function getOperatorSettlement(db: DbOrTx, params: { operatorId: string; id: string }) {
  const rows = await db
    .select(settlementColumns)
    .from(settlements)
    .innerJoin(operators, eq(operators.id, settlements.operatorId))
    .where(
      and(
        eq(settlements.id, params.id),
        eq(settlements.operatorId, params.operatorId),
        ne(settlements.status, 'draft'),
      ),
    );
  return (await withDetails(db, rows))[0] ?? null;
}

export type SettlementDetail = NonNullable<Awaited<ReturnType<typeof getSettlement>>>;

/** 精算の明細の CSV（Excel で開けるように BOM つき）。複数の精算をまとめて出せる。調整も 1 行ずつ出す */
export function settlementsToCsv(rows: SettlementDetail[], dateOf: (d: Date) => string): string {
  const header = [
    '精算月',
    '事業者',
    '状態',
    '予約番号',
    '参加日',
    'プラン',
    '区分',
    '受け取り',
    '返金',
    '対象額',
    '手数料',
    '支払額',
  ];
  const lines: (string | number)[][] = [];
  for (const s of rows) {
    for (const i of s.items) {
      lines.push([
        s.period,
        s.operatorName,
        settlementStatusLabel(s.status, s.payoutAmount),
        i.bookingNo,
        dateOf(i.startsAt),
        i.menuTitle,
        SETTLEMENT_ITEM_LABELS[i.kind],
        i.paidAmount,
        i.refundAmount,
        i.grossAmount,
        i.commissionAmount,
        i.payoutAmount,
      ]);
    }
    for (const a of s.adjustments) {
      lines.push([
        s.period,
        s.operatorName,
        settlementStatusLabel(s.status, s.payoutAmount),
        a.bookingNo,
        '',
        `${a.originPeriod ?? ''} の精算の調整`,
        ADJUSTMENT_REASON_LABELS[a.reason],
        '',
        '',
        a.grossDelta,
        a.commissionDelta,
        a.payoutDelta,
      ]);
    }
  }
  return toCsv(header, lines);
}
