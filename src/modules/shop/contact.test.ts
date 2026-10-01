import { describe, expect, it } from 'vitest';
import { dayOfContact, shopContact, telHref } from './contact';

describe('shopContact', () => {
  it('組合の電話・受付時間・メール', () => {
    expect(
      shopContact({
        shopName: '沖縄県マリンレジャー事業協同組合',
        shopPhone: '098-000-2222',
        shopBusinessHours: '9:00〜17:00',
        shopEmail: 'info@example.com',
      }),
    ).toEqual({
      phone: '098-000-2222',
      hours: '9:00〜17:00',
      name: '沖縄県マリンレジャー事業協同組合',
      email: 'info@example.com',
    });
  });

  it('メールだけでも連絡先として扱い、受付時間は出さない', () => {
    expect(shopContact({ shopBusinessHours: '9:00〜17:00', shopEmail: 'info@example.com' })).toEqual({
      phone: null,
      hours: null,
      name: null,
      email: 'info@example.com',
    });
  });

  it('電話もメールもなければ null（連絡先を案内しない）', () => {
    expect(shopContact({ shopName: '組合', shopPhone: null, shopEmail: '' })).toBeNull();
  });
});

describe('dayOfContact', () => {
  it('実施事業者の電話があれば、事業者名・受付時間つき', () => {
    expect(
      dayOfContact({
        operatorName: 'アクアマリン',
        operatorPhone: '098-000-1111',
        operatorContactHours: '8:00〜18:00',
      }),
    ).toEqual({ phone: '098-000-1111', hours: '8:00〜18:00', name: 'アクアマリン', email: null });
  });

  it('事業者の電話がなければ null', () => {
    expect(dayOfContact({ operatorName: 'アクアマリン', operatorPhone: '' })).toBeNull();
  });
});

describe('telHref', () => {
  it('数字と + だけにする', () => {
    expect(telHref('098-000 1111')).toBe('tel:0980001111');
    expect(telHref('+81 (98) 000-1111')).toBe('tel:+81980001111');
  });
});
