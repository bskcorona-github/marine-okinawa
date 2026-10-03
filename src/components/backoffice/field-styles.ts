/**
 * 管理画面の <select>・日付欄を Input と同じ見た目・タップしやすい高さにする。
 * スマホでは文字を 16px にする（iPhone は 16px より小さい欄を押すと画面を拡大してしまう。Input と同じ）
 */
export const SELECT_CLASS =
  'h-9 rounded-lg border border-input bg-white px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:h-11 md:text-sm';

/** 確認ダイアログ（ConfirmDialog）の開くボタンを、色付きの主ボタンにする（承認・確定など、その画面の主な操作） */
export const PRIMARY_TRIGGER_CLASS =
  'border-transparent bg-primary text-primary-foreground hover:bg-primary/80 hover:text-primary-foreground';
