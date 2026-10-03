import { addDays, addMonths } from '@/lib/dates';
import { isOwnKey } from '@/lib/own';
import { isMonthString, isUuid } from '@/lib/validation';
import { MENU_CATEGORY_LABELS } from '@/modules/booking/labels';

/** 一度に見られる月数の上限（2 年）と、省略したときの月数（直近 12 か月） */
export const MAX_ANALYTICS_MONTHS = 24;
export const DEFAULT_MONTHS = 12;

/** 期間の選びなおしに出す月の数（今月から 3 年前まで） */
export const SELECTABLE_MONTHS = 36;

/**
 * 分析の期間を URL の値から決める（YYYY-MM）。省略時は直近 12 か月（今月まで）。
 * 今月より先の月は選べない。from が to より後なら直近 12 か月にし、長すぎる期間は to から上限までにする
 */
export function analyticsRange(
  fromValue: unknown,
  toValue: unknown,
  currentMonth: string,
): { from: string; to: string } {
  const to = isMonthString(toValue) && toValue <= currentMonth ? toValue : currentMonth;
  let from = isMonthString(fromValue) && fromValue <= to ? fromValue : addMonths(to, -(DEFAULT_MONTHS - 1));
  const earliest = addMonths(to, -(MAX_ANALYTICS_MONTHS - 1));
  if (from < earliest) from = earliest;
  return { from, to };
}

/**
 * URL で指定した期間を、そのまま出せなかったときの知らせ（黙って変えない）。そのまま出せたときは null。
 * 理由は、先の月・開始と終了が逆・長すぎる（上限の月数まで縮めた）のどれか
 */
export function rangeNotice(
  fromValue: unknown,
  toValue: unknown,
  range: { from: string; to: string },
  currentMonth: string,
): string | null {
  const from = isMonthString(fromValue) ? fromValue : null;
  const to = isMonthString(toValue) ? toValue : null;
  if (to && to > currentMonth) return '先の月は選べないため、今月までを出しています。';
  if (from && from > range.to) {
    return `開始の月が終了の月より後だったため、終了の月までの直近 ${DEFAULT_MONTHS} か月を出しています。`;
  }
  if (from && from < range.from) {
    return `一度に見られるのは ${MAX_ANALYTICS_MONTHS} か月までのため、終了の月から数えて ${MAX_ANALYTICS_MONTHS} か月を出しています。`;
  }
  return null;
}

/** よく使う期間（直近 12 か月・今年・昨年・先月・今月） */
export function rangePresets(currentMonth: string): { key: string; label: string; from: string; to: string }[] {
  const year = Number(currentMonth.slice(0, 4));
  const lastMonth = addMonths(currentMonth, -1);
  return [
    { key: '12m', label: '直近 12 か月', from: addMonths(currentMonth, -(DEFAULT_MONTHS - 1)), to: currentMonth },
    { key: 'year', label: '今年', from: `${year}-01`, to: currentMonth },
    { key: 'last-year', label: '昨年', from: `${year - 1}-01`, to: `${year - 1}-12` },
    { key: 'last-month', label: '先月', from: lastMonth, to: lastMonth },
    { key: 'month', label: '今月', from: currentMonth, to: currentMonth },
  ];
}

/** その月の 1 日と末日（YYYY-MM-DD。日報・予約台帳へのリンクに使う） */
export function monthDates(from: string, to: string = from): { first: string; last: string } {
  return { first: `${from}-01`, last: addDays(`${addMonths(to, 1)}-01`, -1) };
}

export const TABS = {
  overview: '概況',
  requests: '申込と取消',
  plans: 'プラン・事業者',
  busy: '混み具合',
} as const;
export type Tab = keyof typeof TABS;

/** 概況のグラフに出す値 */
export const METRICS = { participants: '参加人数', amount: '取扱高', requests: '申込' } as const;
export type Metric = keyof typeof METRICS;

/** 申込のゆくえの受付経路 */
export const SOURCES = { all: 'すべて', web: 'Web', manual: '電話・LINE・店頭' } as const;
export type Source = keyof typeof SOURCES;

/** プラン別の並べ方と、まとめ方 */
export const SORTS = { amount: '取扱高', people: '参加人数', occupancy: '埋まり率', cancel: '取消の割合' } as const;
export type Sort = keyof typeof SORTS;
export const VIEWS = { plan: 'プラン別', category: '種類別' } as const;
export type View = keyof typeof VIEWS;

/**
 * 混み具合の色の付け方。ふだんは 0〜100% を決まった区切りで塗る（空いている時期が混んで見えないように）。
 * relative は、表でいちばん埋まっているマスに合わせて塗る（どこも空いているときに、違いを見るため）
 */
export const SCALES = { fixed: '0〜100% で塗る', relative: '違いが見えるように塗る' } as const;
export type Scale = keyof typeof SCALES;

export type AnalyticsParams = {
  from: string;
  to: string;
  tab: Tab;
  metric: Metric;
  source: Source;
  sort: Sort;
  view: View;
  /** プラン別をすべて出す（省略時は上位だけ） */
  all: boolean;
  /** 混み具合の絞り込み：プラン・種類・貸切（艇）を含めるか */
  menu: string | null;
  category: keyof typeof MENU_CATEGORY_LABELS | null;
  charter: boolean;
  /** 混み具合の色の付け方 */
  scale: Scale;
};

/** 分析の画面の URL の値を読む（知らない値は既定に戻す） */
export function parseAnalyticsParams(get: (key: string) => unknown, currentMonth: string): AnalyticsParams {
  const pick = <K extends string>(record: Record<K, unknown>, key: string, fallback: K): K => {
    const value = get(key);
    return isOwnKey(record, value) ? value : fallback;
  };
  const category = get('category');
  const menu = get('menu');
  return {
    ...analyticsRange(get('from'), get('to'), currentMonth),
    tab: pick(TABS, 'tab', 'overview'),
    metric: pick(METRICS, 'metric', 'participants'),
    source: pick(SOURCES, 'source', 'all'),
    sort: pick(SORTS, 'sort', 'amount'),
    view: pick(VIEWS, 'view', 'plan'),
    all: get('all') === '1',
    menu: isUuid(menu) ? menu : null,
    category: isOwnKey(MENU_CATEGORY_LABELS, category) ? category : null,
    charter: get('charter') === '1',
    scale: pick(SCALES, 'scale', 'fixed'),
  };
}

const DEFAULTS: Omit<AnalyticsParams, 'from' | 'to'> = {
  tab: 'overview',
  metric: 'participants',
  source: 'all',
  sort: 'amount',
  view: 'plan',
  all: false,
  menu: null,
  category: null,
  charter: false,
  scale: 'fixed',
};

/**
 * 分析の画面の URL（期間とタブはいつも付け、ほかは既定と違うものだけ）。
 * タブを変えるときは、そのタブの絞り込みを持ち越さない
 */
export function analyticsHref(params: AnalyticsParams, patch: Partial<AnalyticsParams> = {}): string {
  const tabChanged = patch.tab !== undefined && patch.tab !== params.tab;
  const next: AnalyticsParams = { ...(tabChanged ? { ...params, ...DEFAULTS } : params), ...patch };
  const query = new URLSearchParams({ from: next.from, to: next.to, tab: next.tab });
  for (const key of ['metric', 'source', 'sort', 'view', 'scale'] as const) {
    if (next[key] !== DEFAULTS[key]) query.set(key, next[key]);
  }
  if (next.all) query.set('all', '1');
  if (next.menu) query.set('menu', next.menu);
  if (next.category) query.set('category', next.category);
  if (next.charter) query.set('charter', '1');
  return `/admin/analytics?${query}`;
}
