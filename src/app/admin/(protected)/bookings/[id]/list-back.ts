/**
 * 予約一覧の絞り込み・ページを保ったまま戻れるようにする。管理画面の予約一覧の URL だけを受け付ける
 * （ほかの URL へは移らない。画面の「戻る」とアクションの戻り先で同じ判定を使う）
 */
export function bookingListBack(value: unknown): string | null {
  return typeof value === 'string' && (value === '/admin/bookings' || value.startsWith('/admin/bookings?'))
    ? value
    : null;
}
