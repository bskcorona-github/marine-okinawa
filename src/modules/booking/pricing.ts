import { MAX_YEN } from '@/lib/yen';
import { BookingError } from './errors';

export type PriceRow = { id: string; label: string; price: number };
export type ItemRequest = { priceId: string; quantity: number };
export type PricedLine = { priceId: string; label: string; unitPrice: number; quantity: number };

/** 1 料金区分あたりの上限（DB の integer あふれと誤入力を防ぐ） */
const MAX_QUANTITY_PER_ITEM = 500;

/**
 * 料金区分ごとの人数から明細・人数・合計を計算する。prices はそのメニューの有効な料金区分。
 * booked（人数の変更のとき、予約にある明細）の区分は、予約したときの名前・単価のまま計算する
 * （料金表を変えたあとに人数を直しても、ほかの人の料金が変わらないように）
 */
export function priceItems(
  prices: PriceRow[],
  items: ItemRequest[],
  booked: readonly Pick<PricedLine, 'priceId' | 'label' | 'unitPrice'>[] = [],
): { lines: PricedLine[]; partySize: number; totalAmount: number } {
  const byId = new Map<string, PriceRow>(prices.map((p) => [p.id, p]));
  for (const line of booked) byId.set(line.priceId, { id: line.priceId, label: line.label, price: line.unitPrice });
  const seen = new Set<string>();
  const lines: PricedLine[] = [];

  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 0 || item.quantity > MAX_QUANTITY_PER_ITEM) {
      throw new BookingError('INVALID_ITEMS');
    }
    if (seen.has(item.priceId)) throw new BookingError('INVALID_ITEMS');
    seen.add(item.priceId);
    if (item.quantity === 0) continue;
    const price = byId.get(item.priceId);
    if (!price) throw new BookingError('INVALID_ITEMS');
    lines.push({ priceId: price.id, label: price.label, unitPrice: price.price, quantity: item.quantity });
  }

  if (lines.length === 0) throw new BookingError('INVALID_ITEMS');
  const totalAmount = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  // 打ち間違いで桁が増えた料金で、受け付けない額にならないように
  if (totalAmount > MAX_YEN) throw new BookingError('INVALID_ITEMS');
  return { lines, partySize: lines.reduce((sum, l) => sum + l.quantity, 0), totalAmount };
}
