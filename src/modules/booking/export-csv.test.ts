import { describe, expect, it } from 'vitest';
import { csvCell } from '@/lib/csv';
import { bookingsToCsv } from './export-csv';

describe('csvCell', () => {
  it('カンマ・改行・ダブルクォートを含む値はクォートする', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('1行目\n2行目')).toBe('"1行目\n2行目"');
    expect(csvCell('「"特別"」')).toBe('"「""特別""」"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(15000)).toBe('15000');
  });

  it('数式として読まれる先頭文字を無害化する（数値はそのまま）', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+81901234')).toBe("'+81901234");
    expect(csvCell(-500)).toBe('-500');
  });
});

describe('bookingsToCsv', () => {
  it('BOM・見出し・CRLF。日時はショップのタイムゾーン', () => {
    const csv = bookingsToCsv(
      [
        {
          id: 'b1',
          bookingNo: 'AB12CD34',
          status: 'confirmed',
          source: 'web',
          partySize: 2,
          contactName: '沖縄 太郎',
          contactPhone: '+819012345678',
          contactEmail: 'taro@example.com',
          startsAt: new Date('2026-10-01T01:00:00Z'),
          menuTitle: 'パラセーリング',
          capacityUnit: '名',
          guestCount: null,
          totalAmount: 16000,
          operatorName: 'アクアマリン',
          paymentMethod: 'online',
          paymentStatus: 'paid',
          paymentDueAt: null,
          refundDue: false,
          createdAt: new Date('2026-09-28T00:00:00Z'),
          lastMailStatus: 'sent',
          customerNote: '初めてです',
          participantAges: null,
          extraGuestAmount: 0,
          paymentAmount: 16000,
          paymentReceivedAt: new Date('2026-09-29T03:00:00Z'),
          refundDueAmount: null,
          refundedAmount: 0,
          refundedAt: null,
          cancelledAt: null,
          cancelReason: null,
          cancelCategory: null,
          updatedAt: new Date('2026-09-29T03:00:00Z'),
          items: [{ label: '大人', quantity: 2 }],
        },
      ],
      'Asia/Tokyo',
    );
    expect(csv.startsWith('﻿予約番号,申込日時,受付経路,状態,参加日')).toBe(true);
    const [, line] = csv.slice(1).split('\r\n');
    expect(line).toBe(
      [
        'AB12CD34',
        '2026-09-28 09:00',
        'Web',
        '予約確定',
        '2026-10-01',
        '10:00',
        'パラセーリング',
        'アクアマリン',
        '大人 2名',
        '2',
        '',
        '16000',
        '事前払い（組合）',
        '入金済み',
        '16000',
        '2026-09-29',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '沖縄 太郎',
        '090-1234-5678',
        'taro@example.com',
        '',
        '初めてです',
        '2026-09-29 12:00',
      ].join(','),
    );
    expect(csv.endsWith('\r\n')).toBe(true);
  });
});
