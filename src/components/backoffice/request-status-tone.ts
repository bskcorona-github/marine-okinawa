import type { RequestStatus } from '@/modules/partner/requests';

/** 事業者への受入確認の状態のバッジの色（管理画面・事業者画面で共通） */
export const REQUEST_STATUS_TONE: Record<RequestStatus, string> = {
  pending: 'bg-amber-100 text-amber-900',
  accepted: 'bg-emerald-100 text-emerald-900',
  conditional: 'bg-sky-100 text-sky-900',
  declined: 'bg-red-100 text-red-800',
  withdrawn: 'bg-slate-100 text-slate-600',
};
