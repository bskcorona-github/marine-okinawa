/** 管理画面のタイムテーブルのセルの色（予約済み ÷ 定員） */
export function occupancyTone(slot: { status: string; capacity: number; reservedCount: number }): string {
  if (slot.status !== 'open') return 'bg-slate-200 text-slate-500 line-through';
  if (slot.reservedCount > slot.capacity) return 'bg-red-200 text-red-900';
  if (slot.reservedCount === slot.capacity) return 'bg-red-100 text-red-800';
  if (slot.capacity > 0 && slot.reservedCount / slot.capacity >= 0.8) return 'bg-amber-100 text-amber-900';
  if (slot.reservedCount > 0) return 'bg-emerald-100 text-emerald-900';
  return 'bg-white text-slate-700';
}
