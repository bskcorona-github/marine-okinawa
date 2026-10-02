type Plain = Record<string, unknown>;

const isPlainObject = (value: unknown): value is Plain =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);

/** 入れ子のオブジェクトを 1 段だけ開く（{ settings: { a: 1 } } → { 'settings.a': 1 }） */
function flatten(value: Plain): Plain {
  const out: Plain = {};
  for (const [key, v] of Object.entries(value)) {
    if (isPlainObject(v)) for (const [k2, v2] of Object.entries(v)) out[`${key}.${k2}`] = v2;
    else out[key] = v;
  }
  return out;
}

/**
 * 変更の前後から、変わった項目だけを取り出す（履歴を読みやすく、小さくする）。入れ子のオブジェクトは 1 段だけ開く。
 * masked の項目（口座など）は値を残さず、入力のあり・なしだけを残す。before が null（新しく作った）なら after をそのまま
 */
export function changedFields(
  before: Plain | null,
  after: Plain,
  options: { masked?: readonly string[] } = {},
): { before: Plain | null; after: Plain } {
  const mask = (key: string, value: unknown) =>
    options.masked?.includes(key) ? (value ? '（入力あり）' : '（なし）') : value;
  const a = flatten(after);
  if (!before) return { before: null, after: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, mask(k, v)])) };
  const b = flatten(before);
  const outBefore: Plain = {};
  const outAfter: Plain = {};
  for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (JSON.stringify(b[key] ?? null) === JSON.stringify(a[key] ?? null)) continue;
    outBefore[key] = mask(key, b[key] ?? null);
    outAfter[key] = mask(key, a[key] ?? null);
  }
  return { before: outBefore, after: outAfter };
}
