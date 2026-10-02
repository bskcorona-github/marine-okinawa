/**
 * 予約の明細（料金区分と人数）を 1 行にする。例：「大人 2名 / 子供 1名」。
 * 明細がない古い予約は、人数だけ（partySize を渡したとき）
 */
export function formatPartyItems(
  items: readonly { label: string; quantity: number }[],
  unit: string,
  options: { separator?: string; partySize?: number } = {},
): string {
  const text = items.map((i) => `${i.label} ${i.quantity}${unit}`).join(options.separator ?? ' / ');
  return text || (options.partySize !== undefined ? `${options.partySize}${unit}` : '');
}
