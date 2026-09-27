export type MatchDecision =
  | { kind: 'link'; customerId: string }
  | { kind: 'create'; conflict: { emailCustomerId: string; phoneCustomerId: string } | null };

/**
 * 名寄せの判定（設計書 §4.4）
 * - 一致なし → 新規
 * - 一致が 1 人だけ → 紐づけ
 * - メールと電話が別々の顧客に一致 → 新規作成し、統合候補にする
 */
export function decideCustomerMatch(matches: { byEmail: string | null; byPhone: string | null }): MatchDecision {
  const { byEmail, byPhone } = matches;
  if (byEmail && byPhone && byEmail !== byPhone) {
    return { kind: 'create', conflict: { emailCustomerId: byEmail, phoneCustomerId: byPhone } };
  }
  const customerId = byEmail ?? byPhone;
  return customerId ? { kind: 'link', customerId } : { kind: 'create', conflict: null };
}
