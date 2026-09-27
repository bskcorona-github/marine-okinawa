import { describe, expect, it } from 'vitest';
import { accessTokenExpiry, hashAccessToken, issueAccessToken } from './access-token';
import { BOOKING_NO_ALPHABET, generateBookingNo } from './booking-no';
import { priceItems } from './pricing';

describe('generateBookingNo', () => {
  it('紛らわしい文字を含まない 8 文字', () => {
    for (let i = 0; i < 50; i++) {
      const no = generateBookingNo();
      expect(no).toHaveLength(8);
      expect([...no].every((c) => BOOKING_NO_ALPHABET.includes(c))).toBe(true);
    }
  });
});

describe('access token', () => {
  it('トークンとハッシュが対応する', () => {
    const { token, hash } = issueAccessToken();
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(hashAccessToken(token)).toBe(hash);
    expect(hash).not.toContain(token);
  });

  it('有効期限は回の終了から 30 日後', () => {
    const startsAt = new Date('2026-10-01T01:00:00Z');
    expect(accessTokenExpiry(startsAt, 120).toISOString()).toBe('2026-10-31T03:00:00.000Z');
  });
});

describe('priceItems', () => {
  const prices = [
    { id: 'adult', label: '大人', price: 5000 },
    { id: 'child', label: '子供', price: 3000 },
  ];

  it('明細・人数・合計を計算し、0 人の行は除く', () => {
    expect(
      priceItems(prices, [
        { priceId: 'adult', quantity: 2 },
        { priceId: 'child', quantity: 0 },
      ]),
    ).toEqual({
      lines: [{ priceId: 'adult', label: '大人', unitPrice: 5000, quantity: 2 }],
      partySize: 2,
      totalAmount: 10000,
    });
    expect(
      priceItems(prices, [
        { priceId: 'adult', quantity: 1 },
        { priceId: 'child', quantity: 2 },
      ]),
    ).toMatchObject({ partySize: 3, totalAmount: 11000 });
  });

  it.each([
    ['全員 0 人', [{ priceId: 'adult', quantity: 0 }]],
    ['負の人数', [{ priceId: 'adult', quantity: -1 }]],
    ['小数', [{ priceId: 'adult', quantity: 1.5 }]],
    ['上限超え', [{ priceId: 'adult', quantity: 501 }]],
    ['他メニューの料金区分', [{ priceId: 'other', quantity: 1 }]],
    [
      '同じ料金区分の重複',
      [
        { priceId: 'adult', quantity: 1 },
        { priceId: 'adult', quantity: 1 },
      ],
    ],
  ])('%s は INVALID_ITEMS', (_, items) => {
    expect(() => priceItems(prices, items)).toThrowError(expect.objectContaining({ code: 'INVALID_ITEMS' }));
  });
});
