import { randomUUID } from 'node:crypto';

/**
 * URL 名・ID を空欄にしたときの自動の値（「operator-1a2b3c4d」のような英数字の短い乱数。登録申請の承認と同じ作り方）。
 * 半角英字のルールを知らなくても登録できるようにする
 */
export function autoSlug(prefix: 'operator' | 'plan' | 'activity'): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

/**
 * 自動の値で保存する。まれに同じ値がすでに使われていたら（taken）、値を作り直してもう一度保存する（3 回まで）
 */
export async function saveWithAutoSlug<R>(
  prefix: Parameters<typeof autoSlug>[0],
  save: (slug: string) => Promise<R>,
  taken: (result: R) => boolean,
): Promise<R> {
  let result = await save(autoSlug(prefix));
  for (let i = 0; i < 2 && taken(result); i++) result = await save(autoSlug(prefix));
  return result;
}
