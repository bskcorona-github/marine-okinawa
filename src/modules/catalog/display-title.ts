/**
 * 取り込んだプラン名（例：「沖縄県民3割引／【宜野湾発】ホエールウォッチングツアー★GoPro無料レンタル」）を
 * 画面用に「タイトル」「ラベル（先頭の ○○／ や【…】の付記）」「補足（★以降の特典など）」に分ける。
 */
export function splitPlanTitle(raw: string): { title: string; tagline: string | null; labels: string[] } {
  let rest = raw.trim();
  const labels: string[] = [];
  for (;;) {
    const prefix = rest.match(/^([^【／★]{1,20})／\s*/); // 「10名以上団体向け／」
    const bracket = rest.match(/^【([^】]+)】\s*/); // 「【宜野湾発】」
    const found = prefix ?? bracket;
    if (!found) break;
    labels.push(found[1].trim());
    rest = rest.slice(found[0].length);
  }
  const [head, ...tail] = rest.split('★');
  const tagline = tail
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' ・ ');
  const title = head.replace(/[　\s]+/g, ' ').trim();
  return title ? { title, tagline: tagline || null, labels } : { title: raw.trim(), tagline: null, labels: [] };
}
