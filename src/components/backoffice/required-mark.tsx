/** 必須の欄の印（色だけでなく文字でも伝える。狭い欄でも「必／須」と折れないようにする）。管理画面の入力欄で共通 */
export function RequiredMark() {
  return (
    <span className="ml-1.5 inline-block shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap text-red-700">
      必須
    </span>
  );
}
