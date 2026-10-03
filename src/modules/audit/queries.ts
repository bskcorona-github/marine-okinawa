import { and, desc, eq, gte, inArray, isNull, lt, or, sql, type AnyColumn } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { auditLogs, bookings, notifications, paymentEvents, payments, user } from '@/db/schema';

/** 1 ページに出す件数 */
export const LOG_PAGE_SIZE = 100;

/**
 * 続きを読む位置（最後の行の日時と id）。日時は DB の文字列のまま持つ（マイクロ秒まで。JavaScript の Date にすると
 * ミリ秒に丸まり、同じ時刻の行が抜ける）。同じ時刻の行は id の順で並べる
 */
export type LogCursor = { at: string; id: string };

export function parseLogCursor(value: unknown): LogCursor | null {
  if (typeof value !== 'string') return null;
  const [at, id] = value.split('|');
  if (!at || !id || Number.isNaN(Date.parse(at)) || !/^[0-9a-f-]{36}$/.test(id)) return null;
  return { at, id };
}

export const formatLogCursor = (row: { cursorAt: string; id: string }) => `${row.cursorAt}|${row.id}`;

const beforeCursor = (at: AnyColumn, id: AnyColumn, cursor: LogCursor | null | undefined) =>
  cursor ? sql`(${at}, ${id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)` : undefined;

/**
 * 操作の記録（新しい順）。before（この時刻より前）で続きを読む。操作の種類・操作した人の種類で絞れる。
 * since・until で日時の範囲、targetIds で対象（予約・プラン・事業者など）にも絞れる
 */
export async function listAuditLogs(
  db: DbOrTx,
  params: {
    shopId: string;
    action?: string | null;
    actorType?: string | null;
    cursor?: LogCursor | null;
    since?: Date | null;
    until?: Date | null;
    targetIds?: string[] | null;
  },
) {
  return db
    .select({
      id: auditLogs.id,
      createdAt: auditLogs.createdAt,
      cursorAt: sql<string>`${auditLogs.createdAt}::text`,
      action: auditLogs.action,
      actorType: auditLogs.actorType,
      actorName: user.name,
      actorEmail: user.email,
      targetType: auditLogs.targetType,
      targetId: auditLogs.targetId,
      before: auditLogs.before,
      after: auditLogs.after,
    })
    .from(auditLogs)
    .leftJoin(user, eq(user.id, auditLogs.actorId))
    .where(
      and(
        eq(auditLogs.shopId, params.shopId),
        params.action ? eq(auditLogs.action, params.action) : undefined,
        params.actorType ? eq(auditLogs.actorType, params.actorType as 'staff') : undefined,
        params.since ? gte(auditLogs.createdAt, params.since) : undefined,
        params.until ? lt(auditLogs.createdAt, params.until) : undefined,
        params.targetIds ? inArray(auditLogs.targetId, params.targetIds) : undefined,
        beforeCursor(auditLogs.createdAt, auditLogs.id, params.cursor),
      ),
    )
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(LOG_PAGE_SIZE);
}

/** 送れなかった・届いたか分からないメール */
const MAIL_PROBLEM_STATUSES = ['failed', 'bounced', 'unknown'] as const;

/** 送れなかったメール：失敗・届かず・結果不明と、送信中のまま 10 分たったもの（送る途中で処理が止まった） */
const mailProblemSql = or(
  inArray(notifications.status, [...MAIL_PROBLEM_STATUSES]),
  and(eq(notifications.status, 'queued'), lt(notifications.createdAt, sql`now() - interval '10 minutes'`)),
)!;

/** メールの送信記録（新しい順）。problem なら送れなかったものだけ */
export async function listNotificationLog(
  db: DbOrTx,
  params: { shopId: string; problem: boolean; cursor?: LogCursor | null },
) {
  return db
    .select({
      id: notifications.id,
      createdAt: notifications.createdAt,
      cursorAt: sql<string>`${notifications.createdAt}::text`,
      sentAt: notifications.sentAt,
      type: notifications.type,
      status: notifications.status,
      toEmail: notifications.toEmail,
      error: notifications.error,
      bookingId: notifications.bookingId,
      bookingNo: bookings.bookingNo,
    })
    .from(notifications)
    .leftJoin(bookings, eq(bookings.id, notifications.bookingId))
    .where(
      and(
        eq(notifications.shopId, params.shopId),
        params.problem ? mailProblemSql : undefined,
        beforeCursor(notifications.createdAt, notifications.id, params.cursor),
      ),
    )
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(LOG_PAGE_SIZE);
}

/** ダッシュボード・操作の記録で、送れなかったメールを数える期間（日） */
export const MAIL_PROBLEM_WINDOW_DAYS = 14;

/**
 * 予約に結びつかないメール（お問い合わせ・登録申請・プランの審査など）で、この MAIL_PROBLEM_WINDOW_DAYS 日に送れなかったもの。
 * 予約のメールは予約の画面に出るので、ここでは数えない
 */
export async function countUnlinkedMailProblems(db: DbOrTx, params: { shopId: string; now: Date }) {
  const since = new Date(params.now.getTime() - MAIL_PROBLEM_WINDOW_DAYS * 86_400_000);
  const [row] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(notifications)
    .where(
      and(
        eq(notifications.shopId, params.shopId),
        isNull(notifications.bookingId),
        mailProblemSql,
        gte(notifications.createdAt, since),
      ),
    );
  return row?.count ?? 0;
}

/** Stripe から届いた通知（決済・返金・チャージバック）。そのショップの支払いに結びついたものだけ（新しい順） */
export async function listPaymentEventLog(db: DbOrTx, params: { shopId: string; cursor?: LogCursor | null }) {
  return db
    .select({
      id: paymentEvents.id,
      receivedAt: paymentEvents.receivedAt,
      cursorAt: sql<string>`${paymentEvents.receivedAt}::text`,
      stripeEventId: paymentEvents.stripeEventId,
      type: paymentEvents.type,
      result: paymentEvents.result,
      error: paymentEvents.error,
      bookingId: payments.bookingId,
      bookingNo: bookings.bookingNo,
    })
    .from(paymentEvents)
    .innerJoin(payments, eq(payments.id, paymentEvents.paymentId))
    .innerJoin(bookings, eq(bookings.id, payments.bookingId))
    .where(
      and(eq(payments.shopId, params.shopId), beforeCursor(paymentEvents.receivedAt, paymentEvents.id, params.cursor)),
    )
    .orderBy(desc(paymentEvents.receivedAt), desc(paymentEvents.id))
    .limit(LOG_PAGE_SIZE);
}
