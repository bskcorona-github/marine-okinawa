import { BookingError } from './errors';

export type PriceRow = { id: string; label: string; price: number };
export type ItemRequest = { priceId: string; quantity: number };
export type PricedLine = { priceId: string; label: string; unitPrice: number; quantity: number };

/** 1 料金区分あたりの上限（DB の integer あふれと誤入力を防ぐ） */
export const MAX_QUANTITY_PER_ITEM = 500;

/** 料金区分ごとの人数から明細・人数・合計を計算する。prices はそのメニューの有効な料金区分 */
export function priceItems(
  prices: PriceRow[],
  items: ItemRequest[],
): { lines: PricedLine[]; partySize: number; totalAmount: number } {
  const byId = new Map(prices.map((p) => [p.id, p]));
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
  return {
    lines,
    partySize: lines.reduce((sum, l) => sum + l.quantity, 0),
    totalAmount: lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0),
  };
}
