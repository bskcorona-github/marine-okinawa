import { describe, expect, it } from 'vitest';
import { sensitiveChanges } from './change-requests';

describe('sensitiveChanges', () => {
  const current = { bankAccount: '琉球銀行 普通 1234567', email: 'a@example.com', phone: '098-000-0000' };

  it('口座・連絡用メールアドレス・電話番号が変わるときだけ返す', () => {
    expect(sensitiveChanges({ bankAccount: '沖縄銀行 普通 7654321' }, current)).toEqual(['bankAccount']);
    expect(sensitiveChanges({ email: 'b@example.com', contactHours: '9:00〜18:00' }, current)).toEqual(['email']);
    // 先に電話番号だけを書き換えて、折り返しの電話をなりすましの人につながせることがないように
    expect(sensitiveChanges({ phone: '098-111-1111' }, current)).toEqual(['phone']);
    expect(sensitiveChanges({ contactHours: '9:00〜18:00' }, current)).toEqual([]);
  });

  it('同じ値（前後の空白だけの違い）は変わったとみなさない', () => {
    expect(sensitiveChanges({ bankAccount: ' 琉球銀行 普通 1234567 ', email: 'a@example.com' }, current)).toEqual([]);
  });

  it('空欄にする変更も、変わったとみなす', () => {
    expect(sensitiveChanges({ bankAccount: '' }, current)).toEqual(['bankAccount']);
  });
});
