import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/modules/shop/settings';
import { moneyChanges } from './money-changes';

/** 今の設定のままのフォームの値 */
function formOf(overrides: Record<string, string | null>) {
  const s = DEFAULT_SETTINGS;
  const values: Record<string, string | null> = {
    paymentDueDays: String(s.paymentDueDays),
    commissionRate: String(s.commissionRate),
    weatherRefundPercent: String(s.weatherRefundPercent),
    payoutDay: String(s.payoutDay),
    settlementStartMonth: s.settlementStartMonth,
    cancelFreeDays: String(s.cancelFreeDays),
    cancelMidPercent: String(s.cancelMidPercent),
    cancelSameDayPercent: String(s.cancelSameDayPercent),
    cancellationFeeToOperator: s.cancellationFeeToOperator ? 'on' : null,
    receiptModel: s.receiptModel,
    siteName: 'サイト',
    ...overrides,
  };
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) if (value !== null) form.set(key, value);
  return form;
}

describe('moneyChanges', () => {
  it('お金の項目が変わっていなければ空（サイトの文言だけの変更では確かめない）', () => {
    expect(moneyChanges(DEFAULT_SETTINGS, formOf({ siteName: '新しいサイト名' }))).toEqual([]);
  });

  it('変わった項目を、前 → 後の読める形で返す', () => {
    const changes = moneyChanges(DEFAULT_SETTINGS, formOf({ commissionRate: '12.5', payoutDay: '10' }));
    expect(changes).toEqual([
      { label: '組合の手数料率', before: `${DEFAULT_SETTINGS.commissionRate}%`, after: '12.5%' },
      { label: '事業者への支払日', before: '翌月末', after: '翌月 10 日' },
    ]);
  });

  it('数の書き方の違い（10 と 10.0）は変わったとみなさない', () => {
    const form = formOf({ commissionRate: `${DEFAULT_SETTINGS.commissionRate}.0` });
    expect(moneyChanges(DEFAULT_SETTINGS, form)).toEqual([]);
  });

  it('チェックを外したら「する → しない」', () => {
    const changes = moneyChanges(
      { ...DEFAULT_SETTINGS, cancellationFeeToOperator: true },
      formOf({ cancellationFeeToOperator: null }),
    );
    expect(changes).toEqual([{ label: 'キャンセル料を事業者の取り分に', before: 'する', after: 'しない' }]);
  });
});
