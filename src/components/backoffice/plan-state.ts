/** 事業者画面のプランの状態（公開の状態と審査の状態をあわせた、事業者に見せる 1 つの状態） */
export type PlanState = 'draft' | 'publish_pending' | 'rejected' | 'published' | 'paused' | 'archived';

export function planState(plan: { status: string; reviewStatus: string }): PlanState {
  if (plan.status === 'published') return 'published';
  if (plan.status === 'paused') return 'paused';
  if (plan.status === 'archived') return 'archived';
  if (plan.reviewStatus === 'pending') return 'publish_pending';
  if (plan.reviewStatus === 'rejected') return 'rejected';
  return 'draft';
}

export const PLAN_STATE_LABELS: Record<PlanState, string> = {
  draft: '下書き',
  publish_pending: '公開を申請中',
  rejected: '差し戻し（直して再申請）',
  published: '公開中',
  paused: '受付停止中',
  archived: '掲載終了',
};

export const PLAN_STATE_TONE: Record<PlanState, string> = {
  draft: 'bg-slate-100 text-slate-700',
  publish_pending: 'bg-sky-100 text-sky-900',
  rejected: 'bg-amber-100 text-amber-900',
  published: 'bg-emerald-100 text-emerald-900',
  paused: 'bg-orange-100 text-orange-900',
  archived: 'bg-slate-200 text-slate-600',
};
