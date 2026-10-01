/**
 * 箇条書きにする文面（持ち物・料金に含まれるものなど）を項目に分ける。
 * 1 行に 1 項目。行頭の「・」「-」「•」は取り除く。1 行だけで「、」区切りなら、それを項目にする
 */
export function toListItems(text: string | null | undefined): string[] {
  const lines = (text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[・\-•●]\s*/, ''))
    .filter(Boolean);
  if (lines.length === 1 && lines[0].includes('、')) {
    return lines[0]
      .split('、')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return lines;
}
