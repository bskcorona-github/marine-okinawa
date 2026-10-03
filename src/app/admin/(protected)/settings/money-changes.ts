import type { ShopSettings } from '@/modules/shop/settings';

/** 変わったお金の項目（保存の前に「前 → 後」を見せて確かめる） */
export type MoneyChange = { label: string; before: string; after: string };

const percent = (v: string) => `${v}%`;
const payoutDay = (v: string) => (v === '0' ? '翌月末' : `翌月 ${v} 日`);
const yesNo = (v: string) => (v === 'on' || v === 'true' ? 'する' : 'しない');
const RECEIPT_MODELS: Record<string, string> = {
  agent: '事業者の代理として組合が受け取る',
  seller: '組合が売り手になる',
};

/**
 * お金にかかわる設定（手数料率・返金率・支払日・キャンセル料など）。値はフォームの文字列で比べ、表示用に整える。
 * チェックボックスは、チェックがないとフォームに値がないので「しない」として比べる
 */
const MONEY_FIELDS: {
  name: keyof ShopSettings;
  label: string;
  format: (value: string) => string;
  checkbox?: boolean;
}[] = [
  { name: 'paymentDueDays', label: '支払期限', format: (v) => `支払案内から ${v} 日後まで` },
  { name: 'commissionRate', label: '組合の手数料率', format: percent },
  { name: 'weatherRefundPercent', label: '天候中止の返金率', format: percent },
  { name: 'payoutDay', label: '事業者への支払日', format: payoutDay },
  { name: 'settlementStartMonth', label: '精算を始める月', format: (v) => v || '（指定なし）' },
  { name: 'cancelFreeDays', label: 'キャンセル料が無料になる日数', format: (v) => `参加日の ${v} 日前まで` },
  { name: 'cancelMidPercent', label: 'キャンセル料（それを過ぎて前日まで）', format: percent },
  { name: 'cancelSameDayPercent', label: 'キャンセル料（当日・無断キャンセル）', format: percent },
  {
    name: 'cancellationFeeToOperator',
    label: 'キャンセル料を事業者の取り分に',
    format: yesNo,
    checkbox: true,
  },
  { name: 'receiptModel', label: '領収書の型', format: (v) => RECEIPT_MODELS[v] ?? v },
];

/** 今の設定（initial）と、送ろうとしているフォームの値を比べて、変わったお金の項目を返す */
export function moneyChanges(initial: ShopSettings, form: FormData): MoneyChange[] {
  return MONEY_FIELDS.flatMap(({ name, label, format, checkbox }) => {
    const before = checkbox ? (initial[name] ? 'on' : '') : String(initial[name] ?? '');
    const raw = form.get(name);
    const after = checkbox ? (raw === 'on' ? 'on' : '') : String(raw ?? '').trim();
    // 数の欄は「10」と「10.0」のような書き方の違いを同じとみなす
    const same =
      before === after ||
      (before !== '' && after !== '' && !Number.isNaN(Number(after)) && Number(before) === Number(after));
    return same ? [] : [{ label, before: format(before), after: format(after) }];
  });
}
