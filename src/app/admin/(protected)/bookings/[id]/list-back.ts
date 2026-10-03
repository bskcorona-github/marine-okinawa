/** 回の詳細の URL（回の詳細から開いた予約は、回の詳細へ戻す。戻り先のタイムテーブルの表示も引き継ぐ） */
const SLOT_PAGE = /^\/admin\/slots\/[0-9a-f-]{36}(\?back=%2Fadmin%2Ftimetable[^#\s]*)?$/;

/** ダッシュボード（「未確定の申込」から開いた予約は、ダッシュボードへ戻す） */
const DASHBOARD = '/admin';

/**
 * 予約一覧の絞り込み・ページを保ったまま戻れるようにする。管理画面の予約一覧・回の詳細・ダッシュボードの URL だけを
 * 受け付ける（ほかの URL へは移らない。画面の「戻る」とアクションの戻り先で同じ判定を使う）
 */
export function bookingListBack(value: unknown): string | null {
  return typeof value === 'string' &&
    (value === DASHBOARD ||
      value === '/admin/bookings' ||
      value.startsWith('/admin/bookings?') ||
      SLOT_PAGE.test(value))
    ? value
    : null;
}

/** 戻り先のリンクの文言（回の詳細・ダッシュボードから開いたときは、その画面へ戻る） */
export function bookingBackLabel(back: string | null): string {
  if (back === DASHBOARD) return 'ダッシュボードへ戻る';
  return back?.startsWith('/admin/slots/') ? '回の詳細へ戻る' : '予約台帳へ';
}
