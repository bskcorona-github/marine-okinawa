const yen = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });

export function formatYen(amount: number): string {
  return yen.format(amount);
}
