'use client';

import { useId, useState } from 'react';
import { Input } from '@/components/ui/input';
import { formatYen } from '@/lib/format';

const toNumber = (value: string) => {
  const n = Number(value.normalize('NFKC').replace(/[,円¥\s]/g, ''));
  return Number.isInteger(n) ? n : null;
};

/**
 * 金額の入力欄。基準の金額（料金・入金額）と違う額を入れたら、その場で差額を知らせる
 * （入力ミスに気づけるように。違う額でも保存はできる）。
 * refund：取消の返金予定額。入金額より少ないのはふつうなので「キャンセル料」として出し、全額返金・返金なしを 1 回で入れられる
 */
export function AmountField({
  name,
  label,
  expected,
  expectedLabel,
  defaultValue,
  required,
  hint,
  refund,
}: {
  name: string;
  label: string;
  expected: number;
  expectedLabel: string;
  defaultValue: number | '';
  required?: boolean;
  hint?: string;
  refund?: boolean;
}) {
  const [value, setValue] = useState(String(defaultValue));
  const id = useId();
  const amount = toNumber(value);
  const diff = amount === null || value.trim() === '' ? 0 : amount - expected;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block">
        {label}
      </label>
      {hint && <p className="text-xs text-slate-600">{hint}</p>}
      <Input
        id={id}
        name={name}
        inputMode="numeric"
        required={required}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        aria-describedby={diff !== 0 ? `${id}-diff` : undefined}
        className="w-40 tabular-nums"
      />
      {refund && (
        <span className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setValue(String(expected))}
            className="min-h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold hover:bg-slate-50"
          >
            全額返金（{formatYen(expected)}）
          </button>
          <button
            type="button"
            onClick={() => setValue('0')}
            className="min-h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold hover:bg-slate-50"
          >
            返金なし
          </button>
        </span>
      )}
      {refund && amount !== null && value.trim() !== '' && diff <= 0 ? (
        <p id={`${id}-diff`} role="status" className="text-xs text-slate-700">
          {diff === 0
            ? '全額を返金します。'
            : `キャンセル料 ${formatYen(-diff)}（${expectedLabel} ${formatYen(expected)} − 返金 ${formatYen(amount)}）`}
        </p>
      ) : (
        diff !== 0 && (
          <p id={`${id}-diff`} role="status" className="text-xs font-semibold text-amber-800">
            {expectedLabel} {formatYen(expected)} より {formatYen(Math.abs(diff))} {diff > 0 ? '多い' : '少ない'}です。
          </p>
        )
      )}
    </div>
  );
}
