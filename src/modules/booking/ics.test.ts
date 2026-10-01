import { describe, expect, it } from 'vitest';
import { buildBookingIcs } from './ics';

describe('buildBookingIcs', () => {
  it('開始・終了を UTC で出力し、特殊文字をエスケープする', () => {
    const ics = buildBookingIcs({
      uid: 'ABCD1234@marine',
      title: 'パラセーリング, 200m',
      startsAt: new Date('2026-10-01T01:00:00Z'),
      durationMin: 90,
      location: '宜野湾マリーナ; 30分前集合',
      description: '予約番号 ABCD1234\n当日現地払い',
      now: new Date('2026-09-28T00:00:00Z'),
    });
    expect(ics).toContain('DTSTART:20261001T010000Z');
    expect(ics).toContain('DTEND:20261001T023000Z');
    expect(ics).toContain('SUMMARY:パラセーリング\\, 200m');
    expect(ics).toContain('LOCATION:宜野湾マリーナ\\; 30分前集合');
    expect(ics).toContain('DESCRIPTION:予約番号 ABCD1234\\n当日現地払い');
    expect(ics.split('\r\n')[0]).toBe('BEGIN:VCALENDAR');
  });
});
