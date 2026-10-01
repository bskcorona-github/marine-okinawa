import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { toFormIssues } from './zod-ja';

const schema = z.object({
  title: z.string().trim().min(1).max(5),
  count: z.coerce.number().int().min(1).max(10),
  email: z.email(),
  slug: z.string().regex(/^[a-z]+$/, 'URL 名は半角英小文字で入力してください'),
  prices: z.array(z.object({ label: z.string().min(1) })).min(1),
});

describe('toFormIssues', () => {
  it('既定の英語メッセージを、項目名つきの日本語にする', () => {
    const result = schema.safeParse({ title: '', count: '0', email: 'x', slug: 'ABC', prices: [{ label: '' }] });
    expect(result.success).toBe(false);
    const issues = toFormIssues(
      result.error!,
      { title: 'メニュー名', count: '人数', email: 'メール', slug: 'URL 名' },
      (path) =>
        path[0] === 'prices' ? { field: 'prices', label: `料金区分 ${Number(path[1]) + 1} 行目の区分名` } : null,
    );
    expect(issues).toEqual([
      { field: 'title', message: 'メニュー名：入力してください' },
      { field: 'count', message: '人数：1 以上にしてください' },
      { field: 'email', message: 'メール：メールアドレスの形式が正しくありません' },
      { field: 'slug', message: 'URL 名：URL 名は半角英小文字で入力してください' },
      { field: 'prices', message: '料金区分 1 行目の区分名：入力してください' },
    ]);
  });

  it('上限・数字以外の入力', () => {
    const result = schema.safeParse({
      title: '長すぎるタイトル',
      count: 'abc',
      email: 'a@b.cd',
      slug: 'a',
      prices: [],
    });
    const messages = toFormIssues(result.error!, { title: 'メニュー名', count: '人数', prices: '料金区分' }).map(
      (i) => i.message,
    );
    expect(messages).toEqual([
      'メニュー名：5 文字以内で入力してください',
      '人数：数字で入力してください',
      '料金区分：1 件以上登録してください',
    ]);
  });
});
