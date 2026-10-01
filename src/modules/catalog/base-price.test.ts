import { describe, expect, it } from 'vitest';
import { basePriceOf } from './base-price';

describe('basePriceOf', () => {
  it('先頭の料金区分の料金を基準にし、より安い区分があれば知らせる', () => {
    expect(
      basePriceOf([
        { label: '大人', price: 8000 },
        { label: '子供', price: 4000 },
        { label: '幼児', price: 0 },
        { label: '県民割 子供', price: 2800 },
      ]),
    ).toEqual({ price: 8000, hasLowerPrices: true });
  });

  it('季節で分かれていれば安いほう。先頭が無料なら次の有料の区分', () => {
    expect(
      basePriceOf([
        { label: '幼児', price: 0 },
        { label: '大人', price: 9800 },
        { label: '大人', price: 8800 },
      ]),
    ).toEqual({ price: 8800, hasLowerPrices: true });
    expect(basePriceOf([{ label: '1艇', price: 180000 }])).toEqual({ price: 180000, hasLowerPrices: false });
    expect(basePriceOf([])).toEqual({ price: null, hasLowerPrices: false });
  });
});
