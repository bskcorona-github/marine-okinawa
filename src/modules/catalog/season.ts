export type Season = 'on' | 'off';
export type SeasonPeriod = { startDate: string; endDate: string };

/** 日付（ショップのタイムゾーンの YYYY-MM-DD）がオン期の期間に含まれるか */
export function seasonOf(date: string, periods: SeasonPeriod[]): Season {
  return periods.some((p) => p.startDate <= date && date <= p.endDate) ? 'on' : 'off';
}

/** 季節指定のない料金区分（通年）と、その季節の料金区分だけを残す */
export function pricesForSeason<T extends { season: string | null }>(prices: T[], season: Season): T[] {
  return prices.filter((p) => p.season === null || p.season === season);
}

export const SEASON_LABELS: Record<Season, string> = { on: 'オン期', off: 'オフ期' };

/**
 * 「4/25~30・5/1~10・6/6,7,13」形式のオン期の表記を期間の配列にする。
 * startMonth より前の月は翌年として扱う（例：4 月始まりの年度表記の 1 月は翌年 1 月）。
 */
export function parseSeasonText(text: string, options: { year: number; startMonth: number }): SeasonPeriod[] {
  const periods: SeasonPeriod[] = [];
  const pad = (n: number) => String(n).padStart(2, '0');
  const normalized = text.replace(/[～〜]/g, '~').replace(/\s+/g, '');
  for (const segment of normalized.split('・')) {
    const match = segment.match(/(\d{1,2})\/([\d,~]+)/);
    if (!match) continue;
    const month = Number(match[1]);
    const year = month < options.startMonth ? options.year + 1 : options.year;
    for (const part of match[2].split(',')) {
      const [from, to] = part.split('~').map(Number);
      if (!from) continue;
      periods.push({
        startDate: `${year}-${pad(month)}-${pad(from)}`,
        endDate: `${year}-${pad(month)}-${pad(to || from)}`,
      });
    }
  }
  return periods;
}
