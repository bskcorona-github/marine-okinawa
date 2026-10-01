import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, paymentDueAt, resolveSettings, settingsSchema } from './settings';

const TZ = 'Asia/Tokyo';
const jst = (s: string) => new Date(`${s}+09:00`);

describe('resolveSettings', () => {
  it('保存がなければ既定値', () => {
    expect(resolveSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(resolveSettings({}).priceLabel).toBe('お支払総額');
  });

  it('保存された値を使い、足りない項目は既定値で補う', () => {
    const s = resolveSettings({ priceLabel: '料金（税込）', paymentDueDays: 5 });
    expect(s).toMatchObject({ priceLabel: '料金（税込）', paymentDueDays: 5, siteName: DEFAULT_SETTINGS.siteName });
  });

  it('型の合わない値・範囲外の値は捨てる', () => {
    const s = resolveSettings({ paymentDueDays: '3' as never, bookingPaused: 'yes' as never, priceLabel: '' });
    expect(s.paymentDueDays).toBe(3);
    expect(s.bookingPaused).toBe(false);
    expect(s.priceLabel).toBe('お支払総額');
    expect(resolveSettings({ paymentDueDays: 99 }).paymentDueDays).toBe(3);
  });
});

describe('settingsSchema', () => {
  it('チェックボックスの値を真偽値にする', () => {
    const base = { ...DEFAULT_SETTINGS, paymentDueDays: '3', bookingPaused: undefined };
    expect(settingsSchema.parse({ ...base, bookingPaused: 'on' }).bookingPaused).toBe(true);
    expect(settingsSchema.parse(base).bookingPaused).toBe(false);
  });

  it('通知先のメールアドレスは空欄か正しい形式', () => {
    const base = { ...DEFAULT_SETTINGS, paymentDueDays: '3' };
    expect(settingsSchema.safeParse({ ...base, adminNotifyEmail: '' }).success).toBe(true);
    expect(settingsSchema.safeParse({ ...base, adminNotifyEmail: 'not-mail' }).success).toBe(false);
  });
});

describe('paymentDueAt', () => {
  it('支払待ちにした日から N 日後の 23:59', () => {
    const due = paymentDueAt({
      now: jst('2026-10-01T10:00:00'),
      startsAt: jst('2026-10-20T09:00:00'),
      days: 3,
      timezone: TZ,
    });
    expect(due).toEqual(jst('2026-10-04T23:59:00'));
  });

  it('参加日の前日 23:59 を超えない', () => {
    const due = paymentDueAt({
      now: jst('2026-10-01T10:00:00'),
      startsAt: jst('2026-10-03T09:00:00'),
      days: 3,
      timezone: TZ,
    });
    expect(due).toEqual(jst('2026-10-02T23:59:00'));
  });

  it('前日を過ぎていれば開始時刻が期限', () => {
    const start = jst('2026-10-01T15:00:00');
    expect(paymentDueAt({ now: jst('2026-10-01T10:00:00'), startsAt: start, days: 3, timezone: TZ })).toEqual(start);
  });
});
