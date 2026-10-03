/*
 * 分析のグラフの色。区分の色は決まった順で使い、絞り込んでも付け替えない（凡例・表の文字と一緒に出し、色だけで区別させない）。
 * 区分の 5 色（emerald-600・amber-500・rose-600・sky-600・violet-600）は、この順で隣どうしが色覚の違いでも見分けられることを
 * 確かめてある。amber-500 は白地との差が小さいので、数字は必ず文字（凡例・表）でも出す
 */

/** 区分の色（棒・凡例のしるしに使う背景） */
export const SERIES = {
  /** 予約確定・実施（1 つの値だけのグラフもこの色） */
  confirmed: 'bg-emerald-600',
  /** お客様の都合 */
  customer: 'bg-amber-500',
  /** 手配できない（事業者の受入不可・満席など）・組合の都合 */
  unavailable: 'bg-rose-600',
  /** 天候・海況 */
  weather: 'bg-sky-600',
  /** その他・無断キャンセル */
  other: 'bg-violet-600',
  /** 手続き中（まだ決まっていない。区分ではないので灰色） */
  open: 'bg-slate-300',
  /** 前年同月（比べるための控えめな色） */
  previous: 'bg-slate-300',
} as const;

/**
 * 埋まり率の 5 段階の色（sky の 1 色の濃淡。薄い側も白地と見分けられる濃さにしてある）。
 * マスには数字も書くので、色だけに頼らない
 */
const HEAT_COLORS = [
  'bg-sky-400 text-slate-950',
  'bg-sky-500 text-slate-950',
  'bg-sky-600 font-semibold text-white',
  'bg-sky-800 font-semibold text-white',
  'bg-sky-950 font-semibold text-white',
] as const;

export type HeatStep = { min: number; label: string; cell: string };

/**
 * 埋まり率の段階。いちばん高いマスに合わせて 5 等分する（どこも空いているときでも、違いが見えるように）。
 * 区切りは 5% 刻みに丸め、いちばん高いマスが 80% 以上なら 0〜100% を 20% ずつにする。
 * 決まった区切り（0〜100% を 20% ずつ）は heatSteps(1)
 */
export function heatSteps(maxRate: number): HeatStep[] {
  const top = maxRate >= 0.8 ? 1 : Math.max(0.05, Math.ceil(maxRate * 20) / 20);
  const width = top / HEAT_COLORS.length;
  const percent = (rate: number) => Math.round(rate * 100);
  return HEAT_COLORS.map((cell, i) => {
    const from = percent(width * i);
    const to = percent(width * (i + 1));
    const label = i === 0 ? `${to}% 未満` : i === HEAT_COLORS.length - 1 ? `${from}% 以上` : `${from}〜${to}%`;
    return { min: width * i, label, cell };
  });
}

/** 埋まり率（0〜1）の段階 */
export function heatStepOf(steps: HeatStep[], rate: number): HeatStep {
  return [...steps].reverse().find((s) => rate >= s.min - 1e-9) ?? steps[0];
}
