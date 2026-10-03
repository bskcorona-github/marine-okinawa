import { and, count, eq, inArray } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { operatorApplications, operatorChangeRequests } from '@/db/schema';
import { getActionCounts } from '@/modules/booking/queries';
import { countPendingPlanReviews } from '@/modules/catalog/operator-plans';
import { countNewInquiries } from '@/modules/content/inquiries';

/** 管理画面の左のメニューに出す「対応が必要な件数」（メニューの項目の href ごと） */
export type NavCounts = Partial<Record<string, number>>;

export async function getNavCounts(db: DbOrTx, shopId: string, now = new Date()): Promise<NavCounts> {
  const [actions, inquiries, planReviews, applications, changes] = await Promise.all([
    getActionCounts(db, { shopId, now }),
    countNewInquiries(db, shopId),
    countPendingPlanReviews(db, shopId),
    db
      .select({ count: count() })
      .from(operatorApplications)
      .where(and(eq(operatorApplications.shopId, shopId), inArray(operatorApplications.status, ['new', 'reviewing'])))
      .then(([r]) => r?.count ?? 0),
    db
      .select({ count: count() })
      .from(operatorChangeRequests)
      .where(and(eq(operatorChangeRequests.shopId, shopId), eq(operatorChangeRequests.status, 'pending')))
      .then(([r]) => r?.count ?? 0),
  ]);
  // 組合が次に動く予約（ダッシュボードの「要対応」のうち、お客様・事業者・Stripe を待っているものは数えない）
  const bookingActions =
    actions.requested +
    actions.operatorResponded +
    actions.paymentHeld +
    actions.paymentOverdue +
    actions.operatorReports +
    actions.awaitingVerification +
    actions.refundPending +
    actions.overpaid +
    actions.dispute;
  return {
    '/admin': bookingActions,
    '/admin/inquiries': inquiries,
    '/admin/menus': planReviews,
    '/admin/operators': applications + changes,
  };
}

/** 件数の札の読み上げ（何の件数か） */
export const NAV_COUNT_LABELS: Record<string, string> = {
  '/admin': '組合が対応する予約',
  '/admin/inquiries': '未対応のお問い合わせ',
  '/admin/menus': '審査待ちのプラン',
  '/admin/operators': '事業者の申請',
};
