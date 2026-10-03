'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { formatYen } from '@/lib/format';
import { cn } from '@/lib/utils';
import { normalizeYenInput, REFUND_RATE_PRESETS, refundByPercent } from '@/lib/yen';

const toNumber = (value: string) => {
  const n = Number(normalizeYenInput(value));
  return Number.isInteger(n) ? n : null;
};

const PRESET_BTN =
  'flex min-h-11 cursor-pointer flex-col items-start justify-center rounded-lg border px-3 py-2 text-left hover:bg-slate-50 has-[:checked]:border-sky-700 has-[:checked]:bg-sky-50 has-[:checked]:text-sky-900 has-[:checked]:ring-2 has-[:checked]:ring-sky-600';

type RefundChoice = { key: string; yen: number; title: string; sub: string };

/**
 * 金額の入力欄。基準の金額（料金・入金額）と違う額を入れたら、その場で差額を知らせる
 * （入力ミスに気づけるように。違う額でも保存はできる）。
 * refund：円は手入力せず、全額・80%・50%・20%・返金なしを選ぶ（桁の打ち間違いを防ぐ）
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
  min,
  max,
  percentBase,
}: {
  name: string;
  label: string;
  expected: number;
  expectedLabel: string;
  defaultValue: number | '';
  required?: boolean;
  hint?: string;
  refund?: boolean;
  /** 受け付ける下限・上限（送る前にブラウザで確かめる。サーバーでも確かめる） */
  min?: number;
  max?: number;
  /**
   * 割合の基準（入金額）。省略時は expected。実際の返金では expected が未返金の残りなので、入金額を渡す
   */
  percentBase?: number;
}) {
  const [value, setValue] = useState(String(defaultValue));
  const [custom, setCustom] = useState(false);
  const [shownDefault, setShownDefault] = useState(defaultValue);
  if (shownDefault !== defaultValue) {
    setShownDefault(defaultValue);
    setValue(String(defaultValue));
    setCustom(false);
  }
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  const amount = toNumber(value);
  useEffect(() => {
    if (!custom && refund) return;
    const outside =
      value.trim() !== '' &&
      (amount === null || (min !== undefined && amount < min) || (max !== undefined && amount > max));
    ref.current?.setCustomValidity(
      outside
        ? amount === null
          ? '金額を数字で入れてください'
          : `${min !== undefined ? `${formatYen(min)} 以上` : ''}${max !== undefined ? `${formatYen(max)} 以下` : ''}で入れてください`
        : '',
    );
  }, [value, amount, min, max, custom, refund]);
  const diff = amount === null || value.trim() === '' ? 0 : amount - expected;
  const status = (
    <>
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
    </>
  );

  if (!refund) {
    return (
      <div className="space-y-1">
        <label htmlFor={id} className="block">
          {label}
        </label>
        {hint && <p className="text-xs text-slate-600">{hint}</p>}
        <Input
          ref={ref}
          id={id}
          name={name}
          inputMode="numeric"
          required={required}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-describedby={diff !== 0 ? `${id}-diff` : undefined}
          className="w-40 tabular-nums"
        />
        {status}
      </div>
    );
  }

  const base = percentBase ?? expected;
  const lo = min ?? 0;
  const hi = max ?? expected;
  const inRange = (n: number) => n >= lo && n <= hi;
  const choices: RefundChoice[] = [];
  if (inRange(expected)) {
    choices.push({
      key: 'full',
      yen: expected,
      title: expected === base ? '全額（100%）' : '未返金の全額',
      sub: formatYen(expected),
    });
  }
  for (const percent of REFUND_RATE_PRESETS) {
    const yen = refundByPercent(base, percent);
    if (!inRange(yen) || yen === expected || yen === 0) continue;
    choices.push({ key: `p${percent}`, yen, title: `${percent}%`, sub: formatYen(yen) });
  }
  if (inRange(0)) choices.push({ key: 'none', yen: 0, title: '返金なし（0%）', sub: formatYen(0) });
  if (typeof defaultValue === 'number' && inRange(defaultValue) && !choices.some((c) => c.yen === defaultValue)) {
    choices.unshift({ key: 'initial', yen: defaultValue, title: 'この予約の案', sub: formatYen(defaultValue) });
  }
  const allowCustom = lo < hi;
  const pick = (yen: number) => {
    setCustom(false);
    setValue(String(yen));
  };

  return (
    <div className="space-y-2">
      <p className="block font-medium" id={`${id}-label`}>
        {label}
      </p>
      {hint && <p className="text-xs text-slate-600">{hint}</p>}
      {!custom && (
        <div
          role="radiogroup"
          aria-labelledby={`${id}-label`}
          aria-required={required || undefined}
          className="grid grid-cols-2 gap-2 sm:grid-cols-3"
        >
          {choices.map((c) => (
            <label key={c.key} className={PRESET_BTN}>
              <input
                type="radio"
                name={name}
                value={c.yen}
                required={required}
                checked={amount === c.yen}
                onChange={() => pick(c.yen)}
                className="sr-only"
              />
              <span className="text-sm font-semibold">{c.title}</span>
              <span className="text-xs tabular-nums text-slate-600">{c.sub}</span>
            </label>
          ))}
        </div>
      )}
      {custom && (
        <Input
          ref={ref}
          id={id}
          name={name}
          inputMode="numeric"
          required={required}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-describedby={diff !== 0 ? `${id}-diff` : undefined}
          className="w-40 tabular-nums"
        />
      )}
      {allowCustom && (
        <button
          type="button"
          className="text-xs font-semibold text-sky-800 underline"
          onClick={() => {
            setCustom((open) => !open);
            if (!custom) queueMicrotask(() => ref.current?.focus());
          }}
        >
          {custom ? '割合のボタンに戻る' : 'その他の金額を入力する'}
        </button>
      )}
      {status}
    </div>
  );
}
