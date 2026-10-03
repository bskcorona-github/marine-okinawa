import { describe, expect, it } from 'vitest';
import { bookingBackLabel, bookingListBack } from './[id]/list-back';
import { parseBookingFilters } from './filters';

const parse = (params: Record<string, string>) => parseBookingFilters((key) => params[key]);

describe('予約台帳の絞り込み', () => {
  it('参加日の範囲をそのまま読む', () => {
    expect(parse({ date: '2026-10-03', to: '2026-10-09' })).toMatchObject({ date: '2026-10-03', dateTo: '2026-10-09' });
  });

  it('「まで」だけのときはその 1 日、前後が逆なら入れ替える', () => {
    expect(parse({ to: '2026-10-09' })).toMatchObject({ date: '2026-10-09', dateTo: null });
    expect(parse({ date: '2026-10-09', to: '2026-10-03' })).toMatchObject({ date: '2026-10-03', dateTo: '2026-10-09' });
    expect(parse({ date: '2026-10-03', to: '2026-10-03' })).toMatchObject({ date: '2026-10-03', dateTo: null });
  });

  it('知らない値は無視する', () => {
    expect(parse({ date: 'x', status: 'nope', payment: 'nope', sort: 'nope' })).toMatchObject({
      date: null,
      status: null,
      payment: null,
      sort: null,
    });
  });
});

describe('予約の詳細の戻り先', () => {
  const slot = '/admin/slots/12bc9f7b-dceb-41db-99cb-01f0c4653636';

  it('予約台帳・回の詳細・ダッシュボードだけを受け付ける', () => {
    expect(bookingListBack('/admin')).toBe('/admin');
    expect(bookingListBack('/admin?x=1')).toBeNull();
    expect(bookingListBack('/admin/settings')).toBeNull();
    expect(bookingListBack('/admin/bookings?status=open')).toBe('/admin/bookings?status=open');
    expect(bookingListBack(slot)).toBe(slot);
    expect(bookingListBack(`${slot}?back=%2Fadmin%2Ftimetable%3Fdate%3D2026-10-03`)).not.toBeNull();
    expect(bookingListBack('https://example.com/admin/bookings')).toBeNull();
    expect(bookingListBack('//example.com')).toBeNull();
    expect(bookingListBack(`${slot}?back=https://example.com`)).toBeNull();
    expect(bookingListBack('/admin/slots/not-a-uuid')).toBeNull();
  });

  it('戻るリンクの文言', () => {
    expect(bookingBackLabel(slot)).toBe('回の詳細へ戻る');
    expect(bookingBackLabel('/admin')).toBe('ダッシュボードへ戻る');
    expect(bookingBackLabel('/admin/bookings')).toBe('予約台帳へ');
    expect(bookingBackLabel(null)).toBe('予約台帳へ');
  });
});
