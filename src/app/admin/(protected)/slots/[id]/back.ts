/** 予約の詳細の URL（予約の詳細の「この回を見る」から開いた回は、その予約へ戻す） */
const BOOKING_PAGE = /^\/admin\/bookings\/[0-9a-f-]{36}$/;

/**
 * 回の詳細の戻り先。タイムテーブル（週表示・絞り込みつき）か、開いた元の予約の詳細だけを受け付ける
 * （他サイトへの移動は受け付けない。画面の「戻る」とアクションの戻り先で同じ判定を使う）
 */
export function slotBack(value: unknown): string | null {
  return typeof value === 'string' && (value.startsWith('/admin/timetable?') || BOOKING_PAGE.test(value))
    ? value
    : null;
}

/** 戻り先のリンクの文言 */
export function slotBackLabel(back: string): string {
  return back.startsWith('/admin/bookings/') ? '予約の詳細へ戻る' : 'タイムテーブルへ';
}
