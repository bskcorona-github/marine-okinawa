/** 「同じ設定で追加する時刻」で一度に追加できる時刻の数（入力ミス・大量の送信で回の作り直しが重くならないように） */
export const MAX_MORE_TIMES = 12;

/**
 * 「同じ設定で追加する時刻」の欄（「10:30、12:00」など）を、時刻の一覧にする。全角の数字・コロンも受ける。
 * 空欄なら空の一覧、時刻として読めないものがある・多すぎる（MAX_MORE_TIMES より多い）ときは null
 */
export function parseMoreTimes(text: string): string[] | null {
  const normalized = text.replace(/[０-９：]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).trim();
  if (!normalized) return [];
  const times = normalized
    .split(/[\s,、，・]+/)
    .filter(Boolean)
    .map((t) => {
      const m = t.match(/^(\d{1,2}):(\d{2})$/);
      return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
    });
  if (times.length > MAX_MORE_TIMES) return null;
  if (times.some((t) => t === null || !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) return null;
  return [...new Set(times as string[])];
}
