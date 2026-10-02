import { isLowStock } from '@/modules/inventory/availability';

export type OccupancyTone = 'closedBooked' | 'closed' | 'over' | 'full' | 'busy' | 'some' | 'empty';

type SlotLike = { status: string; capacity: number; reservedCount: number };
/** 「残りわずか」の基準（設定画面の △ の基準と同じ） */
export type LowStockThresholds = { lowStockThresholdPercent: number; lowStockThresholdCount: number };

/** 管理画面のタイムテーブルのセルの状態 */
export function occupancyTone(slot: SlotLike, thresholds: LowStockThresholds): OccupancyTone {
  // 休止中でも予約が残っている回は、お客様への連絡が必要なので別の色にする
  if (slot.status !== 'open') return slot.reservedCount > 0 ? 'closedBooked' : 'closed';
  if (slot.reservedCount > slot.capacity) return 'over';
  if (slot.reservedCount === slot.capacity) return 'full';
  const low = isLowStock({
    capacity: slot.capacity,
    reservedCount: slot.reservedCount,
    thresholdPercent: thresholds.lowStockThresholdPercent,
    thresholdCount: thresholds.lowStockThresholdCount,
  });
  if (low) return 'busy';
  if (slot.reservedCount > 0) return 'some';
  return 'empty';
}

export const TONE_STYLE: Record<OccupancyTone, { cell: string; bar: string; label: string }> = {
  closedBooked: {
    cell: 'bg-red-50 text-red-900 border-2 border-red-500',
    bar: 'bg-red-500',
    label: '休止・予約あり（要連絡）',
  },
  closed: { cell: 'bg-slate-100 text-slate-600 border-slate-300', bar: 'bg-slate-300', label: '休止' },
  over: { cell: 'bg-red-600 text-white border-red-700', bar: 'bg-white', label: '定員超過' },
  full: { cell: 'bg-red-100 text-red-900 border-red-300', bar: 'bg-red-600', label: '満席' },
  busy: { cell: 'bg-amber-100 text-amber-950 border-amber-300', bar: 'bg-amber-600', label: '残りわずか' },
  some: { cell: 'bg-emerald-50 text-emerald-950 border-emerald-300', bar: 'bg-emerald-600', label: '予約あり' },
  empty: { cell: 'bg-white text-slate-800 border-slate-300', bar: 'bg-slate-300', label: '予約なし' },
};

/** セルに出す状態の文字（色が分からなくても読めるようにする） */
export function occupancyText(slot: SlotLike, unit = ''): string {
  if (slot.status !== 'open') return slot.reservedCount > 0 ? `休止・予約${slot.reservedCount}${unit}` : '休止';
  if (slot.reservedCount > slot.capacity) return `超過 +${slot.reservedCount - slot.capacity}${unit}`;
  if (slot.reservedCount === slot.capacity) return '満席';
  return `残り ${slot.capacity - slot.reservedCount}${unit}`;
}
