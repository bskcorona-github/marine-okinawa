import type { SettlementStatus } from '@/modules/settlement/settlements';

/** 精算の状態のバッジの色（管理画面・事業者画面で共通） */
export const SETTLEMENT_STATUS_TONE: Record<SettlementStatus, string> = {
  draft: 'bg-slate-100 text-slate-700',
  confirmed: 'bg-sky-100 text-sky-900',
  paid: 'bg-emerald-100 text-emerald-900',
};
