import { describe, expect, it } from 'vitest';
import { refundByPercent } from '@/lib/yen';
import { DEFAULT_SETTINGS } from '@/modules/shop/settings';
import { cancellationFeePercent, daysBeforeActivity, suggestedRefund } from './cancellation-fee';

const tz = 'Asia/Tokyo';
// 2026-10-10 09:00（日本時間）の回
const startsAt = new Date('2026-10-10T00:00:00Z');

describe('キャンセル料', () => {
  it('参加日の何日前かを、日本の日付で数える', () => {
    expect(daysBeforeActivity({ startsAt, now: new Date('2026-10-02T15:30:00Z'), timezone: tz })).toBe(7);
    expect(daysBeforeActivity({ startsAt, now: new Date('2026-10-09T14:59:00Z'), timezone: tz })).toBe(1);
    expect(daysBeforeActivity({ startsAt, now: new Date('2026-10-09T15:00:00Z'), timezone: tz })).toBe(0);
  });

  it('初期値：7 日前より前は無料、前日まで 50%、当日 100%', () => {
    expect(cancellationFeePercent(DEFAULT_SETTINGS, 7)).toBe(0);
    expect(cancellationFeePercent(DEFAULT_SETTINGS, 6)).toBe(50);
    expect(cancellationFeePercent(DEFAULT_SETTINGS, 1)).toBe(50);
    expect(cancellationFeePercent(DEFAULT_SETTINGS, 0)).toBe(100);
    expect(cancellationFeePercent(DEFAULT_SETTINGS, -1)).toBe(100);
  });

  it('返金予定額の初期値：取消はキャンセル料を引き、天候中止は返金率をかける。返金済みより少なくしない', () => {
    const base = {
      settings: DEFAULT_SETTINGS,
      paidAmount: 9000,
      refundedAmount: 0,
      totalAmount: 9000,
      startsAt,
      timezone: tz,
    };
    const twoDaysBefore = new Date('2026-10-08T03:00:00Z');
    expect(suggestedRefund({ ...base, kind: 'cancelled', now: twoDaysBefore })).toEqual({
      amount: 4500,
      feePercent: 50,
      daysBefore: 2,
    });
    expect(suggestedRefund({ ...base, kind: 'weather_cancelled', now: twoDaysBefore }).amount).toBe(9000);
    expect(
      suggestedRefund({
        ...base,
        settings: { ...DEFAULT_SETTINGS, weatherRefundPercent: 80 },
        kind: 'weather_cancelled',
        now: twoDaysBefore,
      }).amount,
    ).toBe(7200);
    expect(suggestedRefund({ ...base, refundedAmount: 6000, kind: 'cancelled', now: twoDaysBefore }).amount).toBe(6000);
  });

  it('キャンセル料は料金にかける：二重のお支払いがあっても、キャンセル料は料金の率の分だけ', () => {
    const base = { settings: DEFAULT_SETTINGS, refundedAmount: 0, startsAt, timezone: tz, kind: 'cancelled' as const };
    const twoDaysBefore = new Date('2026-10-08T03:00:00Z');
    // 料金 9,000 円に 18,000 円払われた：キャンセル料 4,500 円だけを残し、13,500 円を返す
    expect(suggestedRefund({ ...base, paidAmount: 18000, totalAmount: 9000, now: twoDaysBefore }).amount).toBe(13500);
    // 料金より少なく受け取った：受け取った額にかける
    expect(suggestedRefund({ ...base, paidAmount: 6000, totalAmount: 9000, now: twoDaysBefore }).amount).toBe(3000);
    // 1 円未満のキャンセル料は切り捨て（9,999 円の 50% → 4,999 円）
    expect(suggestedRefund({ ...base, paidAmount: 9999, totalAmount: 9999, now: twoDaysBefore }).amount).toBe(5000);
  });

  it('返金率のワンクリック：入金額の 50%・20% は切り捨て、0% は返金なし、100% は全額', () => {
    expect(refundByPercent(10000, 80)).toBe(8000);
    expect(refundByPercent(10000, 50)).toBe(5000);
    expect(refundByPercent(10000, 20)).toBe(2000);
    expect(refundByPercent(10000, 0)).toBe(0);
    expect(refundByPercent(10000, 100)).toBe(10000);
    expect(refundByPercent(9999, 50)).toBe(4999);
    expect(refundByPercent(0, 50)).toBe(0);
  });
});
