import { describe, expect, it } from 'vitest';
import { autoSlug, saveWithAutoSlug } from './auto-slug';

describe('autoSlug', () => {
  it('URL 名の決まり（半角英小文字・数字・ハイフン）に合う値を作る', () => {
    for (const prefix of ['operator', 'plan', 'activity'] as const) {
      expect(autoSlug(prefix)).toMatch(new RegExp(`^${prefix}-[a-f0-9]{8}$`));
      expect(autoSlug(prefix)).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
});

describe('saveWithAutoSlug', () => {
  it('使われていたら作り直して保存し直す（3 回まで）', async () => {
    const tried: string[] = [];
    const result = await saveWithAutoSlug(
      'plan',
      async (slug) => {
        tried.push(slug);
        return tried.length < 2 ? 'taken' : 'ok';
      },
      (r) => r === 'taken',
    );
    expect(result).toBe('ok');
    expect(tried).toHaveLength(2);
    expect(new Set(tried).size).toBe(2);
  });

  it('3 回とも使われていたら、最後の結果を返す', async () => {
    let count = 0;
    const result = await saveWithAutoSlug(
      'activity',
      async () => {
        count++;
        return 'taken';
      },
      (r) => r === 'taken',
    );
    expect(result).toBe('taken');
    expect(count).toBe(3);
  });
});
