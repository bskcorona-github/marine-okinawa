import { describe, expect, it } from 'vitest';
import { decideCustomerMatch } from './match';
import { normalizeEmail, normalizePhone } from './normalize';

describe('normalize', () => {
  it('メールは前後の空白を除いて小文字にする', () => {
    expect(normalizeEmail('  Taro@Example.COM ')).toBe('taro@example.com');
    expect(normalizeEmail('   ')).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });

  it('電話番号は E.164 にする', () => {
    expect(normalizePhone('090-1234-5678')).toBe('+819012345678');
    expect(normalizePhone('09012345678')).toBe('+819012345678');
    expect(normalizePhone('+1 415 555 2671')).toBe('+14155552671');
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });
});

describe('decideCustomerMatch', () => {
  it('一致なしは新規', () => {
    expect(decideCustomerMatch({ byEmail: null, byPhone: null })).toEqual({ kind: 'create', conflict: null });
  });

  it('片方だけ一致なら紐づけ', () => {
    expect(decideCustomerMatch({ byEmail: 'a', byPhone: null })).toEqual({ kind: 'link', customerId: 'a' });
    expect(decideCustomerMatch({ byEmail: null, byPhone: 'b' })).toEqual({ kind: 'link', customerId: 'b' });
  });

  it('両方が同じ顧客なら紐づけ', () => {
    expect(decideCustomerMatch({ byEmail: 'a', byPhone: 'a' })).toEqual({ kind: 'link', customerId: 'a' });
  });

  it('別々の顧客に一致したら新規作成して統合候補にする', () => {
    expect(decideCustomerMatch({ byEmail: 'a', byPhone: 'b' })).toEqual({
      kind: 'create',
      conflict: { emailCustomerId: 'a', phoneCustomerId: 'b' },
    });
  });
});
