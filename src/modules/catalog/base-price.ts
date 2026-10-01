/**
 * 一覧・詳細の「〜円」に出す基準の料金。表示順で先頭の料金区分（多くは大人）の料金にし、
 * 季節で分かれていれば安いほうにする。子供・割引の料金を「〜円から」に使うと実際に払う額と離れるため。
 * 先頭の区分より安い区分（子供・割引・無料など）があれば hasLowerPrices を true にする
 */
export function basePriceOf(prices: { label: string; price: number }[]): {
  price: number | null;
  hasLowerPrices: boolean;
} {
  const first = prices.find((p) => p.price > 0);
  if (!first) return { price: null, hasLowerPrices: false };
  const price = Math.min(...prices.filter((p) => p.label === first.label && p.price > 0).map((p) => p.price));
  return { price, hasLowerPrices: prices.some((p) => p.price < price) };
}
