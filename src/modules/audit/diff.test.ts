import { describe, expect, it } from 'vitest';
import { changedFields } from './diff';

describe('変更の差分', () => {
  it('変わった項目だけを残し、入れ子の設定は 1 段開く', () => {
    expect(
      changedFields(
        { name: '組合', settings: { commissionRate: 10, payoutDay: 0 }, tags: ['a'] },
        { name: '組合', settings: { commissionRate: 12, payoutDay: 0 }, tags: ['a', 'b'] },
      ),
    ).toEqual({
      before: { 'settings.commissionRate': 10, tags: ['a'] },
      after: { 'settings.commissionRate': 12, tags: ['a', 'b'] },
    });
  });

  it('口座などは値を残さない。新しく作ったときは後の値だけ', () => {
    expect(
      changedFields(
        { bankAccount: '琉球銀行 1234567' },
        { bankAccount: '沖縄銀行 7654321' },
        { masked: ['bankAccount'] },
      ),
    ).toEqual({
      before: { bankAccount: '（入力あり）' },
      after: { bankAccount: '（入力あり）' },
    });
    expect(changedFields(null, { name: 'ココ', bankAccount: '' }, { masked: ['bankAccount'] })).toEqual({
      before: null,
      after: { name: 'ココ', bankAccount: '（なし）' },
    });
  });
});
