import { describe, expect, it } from 'vitest';
import { settlementLine, type Candidate } from './settlements';

const settings = { commissionRate: 10, cancellationFeeToOperator: true };
const base: Candidate = {
  bookingId: 'b1',
  operatorId: 'o1',
  status: 'verified',
  paymentMethod: 'online',
  totalAmount: 10000,
  paymentStatus: 'paid',
  paymentAmount: 10000,
  refundedAmount: 0,
  refundDueAmount: null,
};

describe('精算の明細 1 行（settlementLine）', () => {
  it('事前払いの実施：受け取り − 返金から手数料（1 件ごとに四捨五入）を引いて払う', () => {
    expect(settlementLine(base, settings)).toEqual({
      kind: 'activity',
      paid: 10000,
      refund: 0,
      gross: 10000,
      commission: 1000,
      payout: 9000,
    });
    expect(settlementLine({ ...base, refundedAmount: 3000, paymentStatus: 'partially_refunded' }, settings)).toEqual({
      kind: 'activity',
      paid: 10000,
      refund: 3000,
      gross: 7000,
      commission: 700,
      payout: 6300,
    });
    expect(settlementLine({ ...base, paymentAmount: 1234 }, { ...settings, commissionRate: 12.5 })).toMatchObject({
      commission: 154,
      payout: 1080,
    });
    // 入金のない事前払いは入れない
    expect(settlementLine({ ...base, paymentStatus: 'pending' }, settings)).toBeNull();
  });

  it('現地払いの実施：事業者が受け取っているので、手数料をマイナスで載せる', () => {
    expect(settlementLine({ ...base, paymentMethod: 'onsite', paymentStatus: 'pending' }, settings)).toEqual({
      kind: 'onsite',
      paid: 10000,
      refund: 0,
      gross: 10000,
      commission: 1000,
      payout: -1000,
    });
  });

  it('確定後の取消：返さない額をキャンセル料として払う。全額を返す・組合の取り分にする設定なら入れない', () => {
    const cancelled = { ...base, status: 'cancelled', refundDueAmount: 5000 };
    expect(settlementLine(cancelled, settings)).toEqual({
      kind: 'cancellation_fee',
      paid: 10000,
      refund: 5000,
      gross: 5000,
      commission: 500,
      payout: 4500,
    });
    // 返金予定額より多く返していれば、返した額で計算する
    expect(settlementLine({ ...cancelled, refundedAmount: 6000 }, settings)).toMatchObject({
      refund: 6000,
      gross: 4000,
    });
    expect(settlementLine({ ...cancelled, refundDueAmount: 10000 }, settings)).toBeNull();
    expect(settlementLine(cancelled, { ...settings, cancellationFeeToOperator: false })).toBeNull();
  });
});
