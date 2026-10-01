import { describe, expect, it } from 'vitest';
import { bookingStatus } from '@/db/schema';
import {
  canTransition,
  holdsSeats,
  isConfirmedOrLater,
  isOpenRequest,
  NEXT_STATUSES,
  nextStatusesFor,
  SEAT_HOLDING_STATUSES,
  type BookingStatus,
} from './status';

const ALL = bookingStatus.enumValues as readonly BookingStatus[];

describe('予約の状態の遷移', () => {
  it('申込から精算までを順に進められる', () => {
    const path: BookingStatus[] = [
      'requested',
      'reviewing',
      'operator_checking',
      'awaiting_payment',
      'confirmed',
      'completed',
      'verified',
      'settled',
    ];
    for (const [i, from] of path.slice(0, -1).entries()) expect(canTransition(from, path[i + 1])).toBe(true);
  });

  it('事前払いは入金確認（支払待ち）を飛ばして確定できない。現地払いは支払案内を送らずに確定する', () => {
    for (const from of ['requested', 'reviewing', 'operator_checking'] as const) {
      expect(nextStatusesFor(from, 'online')).not.toContain('confirmed');
      expect(nextStatusesFor(from, 'online')).toContain('awaiting_payment');
      expect(nextStatusesFor(from, 'onsite')).toContain('confirmed');
      expect(nextStatusesFor(from, 'onsite')).not.toContain('awaiting_payment');
    }
    expect(nextStatusesFor('awaiting_payment', 'online')).toContain('confirmed');
  });

  it('終わった状態からはどこへも進めない', () => {
    for (const from of ['settled', 'cancelled', 'weather_cancelled', 'no_show'] as const) {
      expect(NEXT_STATUSES[from]).toEqual([]);
    }
  });

  it('催行後は取り消せない（返金などは精算側で扱う）', () => {
    for (const from of ['completed', 'verified', 'settled'] as const)
      expect(canTransition(from, 'cancelled')).toBe(false);
  });

  it('遷移表はすべての状態を持ち、遷移先も正しい状態だけ', () => {
    expect(Object.keys(NEXT_STATUSES).sort()).toEqual([...ALL].sort());
    for (const list of Object.values(NEXT_STATUSES)) for (const to of list) expect(ALL).toContain(to);
  });
});

describe('枠と表示の区分', () => {
  it('取消・天候中止だけが枠を戻す', () => {
    expect(ALL.filter((s) => !holdsSeats(s)).sort()).toEqual(['cancelled', 'weather_cancelled']);
    expect([...SEAT_HOLDING_STATUSES].sort()).toEqual(ALL.filter(holdsSeats).sort());
  });

  it('未確定の申込と確定以降を分ける', () => {
    expect(ALL.filter(isOpenRequest)).toEqual(['requested', 'reviewing', 'operator_checking', 'awaiting_payment']);
    expect(ALL.filter(isConfirmedOrLater)).toEqual(['confirmed', 'completed', 'verified', 'settled']);
  });
});
