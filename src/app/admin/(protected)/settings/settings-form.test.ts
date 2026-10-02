import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { settingsSchema } from '@/modules/shop/settings';
import { shopSettingsSchema } from '@/modules/shop/shops';

const form = readFileSync(new URL('./settings-form.tsx', import.meta.url), 'utf8');

describe('設定の画面', () => {
  it('保存のときに確かめる項目は、すべてフォームに入力欄がある（欄がないと、どの項目を変えても保存できない）', () => {
    const keys = [...Object.keys(settingsSchema.shape), ...Object.keys(shopSettingsSchema.shape)];
    const missing = keys.filter((key) => !form.includes(`name="${key}"`));
    expect(missing).toEqual([]);
  });
});
