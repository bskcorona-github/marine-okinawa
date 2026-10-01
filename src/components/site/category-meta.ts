import { Anchor, Binoculars, Fish, Sailboat, Shell, Ship, Waves, Wind, type LucideIcon } from 'lucide-react';

export type MenuCategory =
  | 'parasailing'
  | 'marine_sports'
  | 'fishing'
  | 'cruise'
  | 'whale_watching'
  | 'snorkeling'
  | 'diving'
  | 'sup'
  | 'kayak'
  | 'other';

/**
 * 画像がないときのカバーの色とアイコン。カテゴリごとに見分けられ、
 * 同じカテゴリのプランが並んでも単調にならないよう色の候補を複数持つ。
 */
export const CATEGORY_META: Record<MenuCategory, { icon: LucideIcon; gradients: string[] }> = {
  parasailing: {
    icon: Wind,
    // 空の色：昼・朝焼け・ラグーン・夕暮れ・桜色の空
    gradients: [
      'from-sky-300 via-sky-500 to-blue-700',
      'from-amber-200 via-orange-300 to-sky-600',
      'from-cyan-200 via-teal-400 to-sky-700',
      'from-indigo-300 via-violet-500 to-blue-800',
      'from-rose-200 via-sky-400 to-indigo-700',
    ],
  },
  marine_sports: {
    icon: Waves,
    gradients: [
      'from-cyan-300 via-teal-500 to-teal-800',
      'from-emerald-300 via-cyan-500 to-blue-700',
      'from-lime-200 via-emerald-500 to-teal-800',
    ],
  },
  fishing: {
    icon: Fish,
    gradients: [
      'from-blue-500 via-indigo-700 to-slate-900',
      'from-sky-600 via-blue-800 to-slate-900',
      'from-teal-500 via-cyan-800 to-slate-900',
    ],
  },
  cruise: {
    icon: Ship,
    gradients: [
      'from-teal-300 via-cyan-600 to-sky-900',
      'from-cyan-300 via-teal-600 to-emerald-900',
      'from-sky-300 via-blue-600 to-indigo-900',
    ],
  },
  // lucide にクジラのアイコンがないため、「見る」ことが伝わる双眼鏡にする（マリンスポーツの波と区別する）
  whale_watching: {
    icon: Binoculars,
    gradients: ['from-slate-400 via-blue-800 to-slate-950', 'from-sky-300 via-slate-600 to-slate-900'],
  },
  snorkeling: { icon: Shell, gradients: ['from-emerald-300 via-teal-500 to-cyan-800'] },
  diving: { icon: Anchor, gradients: ['from-blue-500 via-blue-800 to-indigo-950'] },
  sup: { icon: Sailboat, gradients: ['from-amber-300 via-orange-400 to-rose-500'] },
  kayak: { icon: Sailboat, gradients: ['from-lime-300 via-emerald-500 to-teal-700'] },
  other: { icon: Waves, gradients: ['from-sky-400 via-cyan-600 to-blue-800'] },
};

/** 色の候補に重ねる色相のずれ（同じ候補に当たっても少し違う色に見せる） */
const HUES = ['-hue-rotate-30', '-hue-rotate-15', '', 'hue-rotate-15', 'hue-rotate-30'];
/** 模様（globals.css） */
const PATTERNS = ['bg-waves', 'bg-dots', 'bg-stripes'];
/** 飾りの丸 2 つの置き方 */
const DECORS: [string, string][] = [
  ['-right-6 -bottom-8 size-40', 'top-6 -left-10 size-28'],
  ['-top-12 -right-8 size-44', '-bottom-10 left-10 size-24'],
  ['top-1/2 -left-16 size-48 -translate-y-1/2', 'top-5 right-20 size-14'],
];

/** FNV-1a（短い slug の末尾だけが違っても散らばるよう、最後にかき混ぜる） */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (const ch of text) h = Math.imul(h ^ ch.codePointAt(0)!, 0x01000193) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}

const pick = <T>(list: readonly T[], seed: string, salt: string): T => list[hash(`${seed}#${salt}`) % list.length];

/**
 * seed（slug など）が同じなら常に同じ見た目になる。
 * 色・色相・模様・飾りの置き方をそれぞれ別に選び、同じカテゴリのプランでも見分けやすくする
 */
export function categoryMeta(category: string, seed = '') {
  const meta = CATEGORY_META[category as MenuCategory] ?? CATEGORY_META.other;
  return {
    icon: meta.icon,
    gradient: pick(meta.gradients, seed, 'gradient'),
    hue: pick(HUES, seed, 'hue'),
    pattern: pick(PATTERNS, seed, 'pattern'),
    decor: pick(DECORS, seed, 'decor'),
  };
}
