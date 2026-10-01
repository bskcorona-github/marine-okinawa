'use client';

import { Minus, Plus } from 'lucide-react';
import { startTransition, useActionState, useState, type FormEvent } from 'react';
import { Notice } from '@/components/admin/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatYen } from '@/lib/format';
import { submitManualBooking, type ManualBookingState } from './actions';
import { useHydrated } from '@/lib/use-hydrated';

type Props = {
  slotId: string;
  prices: { id: string; label: string; price: number; meetingPoint: string | null }[];
  unit: string;
  /** 貸切：基本料金に含まれる人数と、超えた 1 名あたりの追加料金（お客様の予約と同じ計算で合計に足す） */
  includedGuests: number | null;
  extraGuestPrice: number | null;
  maxGuests: number | null;
  /** お客様の Web 予約の最少人数（手動予約では受けられるが、注意を出す） */
  minPartySize: number;
  remaining: number;
  isFull: boolean;
  /** 年齢の条件があるプラン（参加者の年齢を聞いておく） */
  requireAges: boolean;
  /** 入金日の初期値（ショップの今日） */
  today: string;
  /** 選べる実施事業者（停止中を除く）と、プランの初期値 */
  operators: { id: string; name: string }[];
  defaultOperatorId: string | null;
  /** 支払方法の案内（振込先など）が設定済みか。未設定なら事前払いの支払待ちは選べない */
  hasPaymentInstructions: boolean;
};

const STATUSES = [
  ['requested', '仮受付', 'あとで事業者に確認し、支払案内を送る'],
  ['awaiting_payment', '支払待ち', '事業者の確認は済み。すぐに支払案内を送る'],
  ['confirmed', '予約確定', '入金済み、または現地払いで確定する'],
] as const;

const SOURCES = [
  ['phone', '電話'],
  ['line', 'LINE'],
  ['walk_in', '店頭'],
] as const;

export function ManualBookingForm({
  slotId,
  prices,
  unit,
  includedGuests,
  extraGuestPrice,
  maxGuests,
  minPartySize,
  remaining,
  isFull,
  requireAges,
  today,
  operators,
  defaultOperatorId,
  hasPaymentInstructions,
}: Props) {
  const [state, formAction, pending] = useActionState<ManualBookingState, FormData>(submitManualBooking, {
    error: null,
  });
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const hydrated = useHydrated();
  const partySize = Object.values(quantities).reduce((sum, n) => sum + n, 0);
  const [guests, setGuests] = useState('');
  const [status, setStatus] = useState<(typeof STATUSES)[number][0]>('requested');
  const [method, setMethod] = useState<'online' | 'onsite'>('online');
  // 入金額：手で直すまでは料金の合計に合わせる
  const [paidInput, setPaidInput] = useState<string | null>(null);
  const guestNumber = Number(guests);
  const extraGuests =
    unit !== '名' && includedGuests && extraGuestPrice && Number.isInteger(guestNumber)
      ? Math.max(0, guestNumber - includedGuests)
      : 0;
  const extraAmount = extraGuests * (extraGuestPrice ?? 0);
  const baseTotal = prices.reduce((sum, p) => sum + p.price * (quantities[p.id] ?? 0), 0);
  const total = baseTotal + extraAmount;
  const overBy = partySize - remaining;
  const setQuantity = (id: string, value: number) =>
    setQuantities((q) => ({ ...q, [id]: Math.max(0, Math.min(500, Math.floor(value) || 0)) }));

  // form の action 属性を使うと送信後に入力がリセットされるため、onSubmit から呼ぶ
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  return (
    <form
      method="post"
      onSubmit={onSubmit}
      className="max-w-xl space-y-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-5"
    >
      <input type="hidden" name="slotId" value={slotId} />
      <fieldset className="space-y-2">
        <legend className="font-semibold">受付経路</legend>
        <div className="flex flex-wrap gap-2 text-sm">
          {SOURCES.map(([value, label], i) => (
            <label
              key={value}
              className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 has-checked:border-sky-600 has-checked:bg-sky-50 has-checked:font-semibold"
            >
              <input type="radio" name="source" value={value} defaultChecked={i === 0} /> {label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="font-semibold">人数</legend>
        <ul className="divide-y divide-slate-100">
          {prices.map((p) => {
            const value = quantities[p.id] ?? 0;
            return (
              <li key={p.id} className="flex items-center justify-between gap-4 py-2">
                <Label htmlFor={`qty-${p.id}`} className="min-w-0 flex-col items-start gap-0">
                  <span>{p.label}</span>
                  <span className="text-xs font-normal text-slate-500">
                    {formatYen(p.price)} / {unit}
                  </span>
                  {p.meetingPoint && (
                    <span className="text-xs font-normal text-slate-500">集合：{p.meetingPoint.split('\n')[0]}</span>
                  )}
                </Label>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setQuantity(p.id, value - 1)}
                    disabled={value === 0}
                    aria-label={`${p.label}を1${unit}減らす`}
                  >
                    <Minus aria-hidden />
                  </Button>
                  <Input
                    id={`qty-${p.id}`}
                    name={`qty.${p.id}`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={500}
                    value={value}
                    onChange={(e) => setQuantity(p.id, Number(e.target.value))}
                    className="w-16 text-center text-base font-semibold tabular-nums"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setQuantity(p.id, value + 1)}
                    aria-label={`${p.label}を1${unit}増やす`}
                  >
                    <Plus aria-hidden />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="flex items-baseline justify-between rounded-lg bg-slate-50 px-3 py-2" aria-live="polite">
          <span className="text-sm text-slate-600">
            合計 {partySize}
            {unit}
          </span>
          <span className="text-xl font-bold text-slate-900 tabular-nums">{formatYen(total)}</span>
        </div>
        {unit === '名' && partySize > 0 && partySize < minPartySize && (
          <p className="text-sm font-medium text-amber-800">
            このプランは Web では {minPartySize} 名からの受付です。{partySize}{' '}
            名で受ける場合は、事業者に確認してください。
          </p>
        )}
        {overBy > 0 && (
          <p className="text-sm font-medium text-red-700">
            残り {remaining}
            {unit}を {overBy}
            {unit}超えています。受ける場合は下の「定員超過の理由」を入力してください。
          </p>
        )}
      </fieldset>

      {unit !== '名' && (
        <div className="space-y-1">
          <Label htmlFor="guestCount">乗船人数（必須）</Label>
          <div className="flex items-center gap-2">
            <Input
              id="guestCount"
              name="guestCount"
              required
              type="number"
              inputMode="numeric"
              min={1}
              max={maxGuests ?? 200}
              value={guests}
              onChange={(e) => setGuests(e.target.value)}
              className="w-24 text-right tabular-nums"
            />
            <span className="text-sm">名{maxGuests ? `（最大 ${maxGuests} 名）` : ''}</span>
          </div>
          {includedGuests && extraGuestPrice ? (
            <p className="text-xs text-slate-500">
              基本料金は {includedGuests} 名まで。{includedGuests + 1} 名目から 1 名につき {formatYen(extraGuestPrice)}{' '}
              を合計に足します。
            </p>
          ) : null}
          {extraGuests > 0 && (
            <p className="text-sm font-medium text-slate-900">
              追加の乗船 {extraGuests} 名 × {formatYen(extraGuestPrice ?? 0)} ＝ {formatYen(extraAmount)}
            </p>
          )}
        </div>
      )}

      <fieldset className="space-y-2">
        <legend className="font-semibold">登録する状態</legend>
        <div className="grid gap-2 text-sm">
          {STATUSES.map(([value, label, hint]) => (
            <label
              key={value}
              className="flex min-h-11 cursor-pointer items-start gap-2 rounded-lg border border-slate-200 px-3 py-2 has-checked:border-sky-600 has-checked:bg-sky-50"
            >
              <input
                type="radio"
                name="initialStatus"
                value={value}
                checked={status === value}
                onChange={() => setStatus(value)}
                // 現地払いは支払案内を送らない（確認が済んだら予約確定で登録する）
                disabled={value === 'awaiting_payment' && (method === 'onsite' || !hasPaymentInstructions)}
                className="mt-0.5"
              />
              <span>
                <span className="font-semibold">{label}</span>
                <span className="block text-xs text-slate-600">
                  {value === 'awaiting_payment' && method === 'onsite'
                    ? '現地払いでは使いません'
                    : value === 'awaiting_payment' && !hasPaymentInstructions
                      ? '支払方法の案内（振込先など）が未設定のため使えません。「設定」で入れてください'
                      : hint}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="font-semibold">実施事業者</legend>
        <select
          name="operatorId"
          defaultValue={defaultOperatorId ?? ''}
          required={status !== 'requested'}
          aria-label="実施事業者"
          className="h-11 w-full rounded-lg border border-input bg-white px-2.5 text-sm sm:w-80"
        >
          <option value="">未割り当て（あとで決める）</option>
          {operators.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
              {o.id === defaultOperatorId ? '（プランの初期値）' : ''}
            </option>
          ))}
        </select>
        {status !== 'requested' && (
          <label className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
            <input type="checkbox" name="operatorConfirmed" value="on" required className="mt-0.5 size-4" />
            <span>
              <span className="block font-medium">実施事業者に受入を確認しました（電話など）</span>
              <span className="block text-xs text-slate-700">
                支払待ち・予約確定で登録するときは、確認したことを履歴に残します。
              </span>
            </span>
          </label>
        )}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="font-semibold">支払方法</legend>
        <div className="flex flex-wrap gap-2 text-sm">
          {(
            [
              ['online', '事前払い（組合）'],
              ['onsite', '現地払い'],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 has-checked:border-sky-600 has-checked:bg-sky-50 has-checked:font-semibold"
            >
              <input
                type="radio"
                name="paymentMethod"
                value={value}
                checked={method === value}
                onChange={() => {
                  setMethod(value);
                  if (value === 'onsite' && status === 'awaiting_payment') setStatus('requested');
                }}
              />
              {label}
            </label>
          ))}
        </div>
        {status === 'confirmed' && method === 'online' && (
          <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
            <p className="font-medium text-amber-950">
              入金済みとして記録します（入金前なら「支払待ち」で登録してください）。
            </p>
            <div className="flex flex-wrap gap-3">
              <div className="space-y-1">
                <Label htmlFor="paymentAmount">入金額（円）</Label>
                <Input
                  id="paymentAmount"
                  name="paymentAmount"
                  inputMode="numeric"
                  required
                  value={paidInput ?? String(total)}
                  onChange={(event) => setPaidInput(event.target.value)}
                  className="w-36 bg-white tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="paymentReceivedOn">入金日</Label>
                <Input
                  id="paymentReceivedOn"
                  name="paymentReceivedOn"
                  type="date"
                  required
                  defaultValue={today}
                  max={today}
                  className="w-44 bg-white"
                />
              </div>
            </div>
            {paidInput !== null && Number(paidInput.replace(/[,，円￥¥\s]/g, '')) !== total && (
              <p role="status" className="text-xs font-semibold text-amber-900">
                料金の合計 {formatYen(total)} と違う金額です。
              </p>
            )}
            <div className="space-y-1">
              <Label htmlFor="paymentNote">入金のメモ（振込名義など・任意）</Label>
              <Input id="paymentNote" name="paymentNote" maxLength={200} className="bg-white" />
            </div>
          </div>
        )}
        {method === 'onsite' && (
          <p className="text-xs text-slate-600">当日、事業者が現地で受け取ります。組合の入金確認はいりません。</p>
        )}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="font-semibold">代表者</legend>
        <div className="space-y-1">
          <Label htmlFor="name">お名前（必須）</Label>
          <Input id="name" name="name" required autoComplete="off" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="phone">電話番号</Label>
            <Input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="off" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="email">メールアドレス</Label>
            <Input id="email" name="email" type="email" autoComplete="off" />
          </div>
        </div>
        <p className="text-xs text-slate-500">電話番号かメールアドレスのどちらかは必須です。</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="sendEmail" defaultChecked className="size-4" />
          メールアドレスがあれば、
          {status === 'requested' ? '受付完了' : status === 'awaiting_payment' ? '支払案内' : '予約確定'}
          のメールを送る
        </label>
        {status === 'confirmed' && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="notifyOperator" value="on" defaultChecked className="size-4" />
            選んだ実施事業者に予約確定をメールで知らせる
          </label>
        )}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="font-semibold">申込の内容（任意）</legend>
        {requireAges && (
          <div className="space-y-1">
            <Label htmlFor="participantAges">参加者の年齢（このプランは年齢の条件があります）</Label>
            <Input id="participantAges" name="participantAges" maxLength={200} placeholder="例：40歳、38歳、9歳" />
          </div>
        )}
        <div className="space-y-1">
          <Label htmlFor="secondChoice">第2希望の日時</Label>
          <Input id="secondChoice" name="secondChoice" maxLength={200} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="customerNote">お客様からの連絡事項</Label>
          <Input id="customerNote" name="customerNote" maxLength={1000} />
        </div>
      </fieldset>

      <div className="space-y-1">
        <Label htmlFor="overCapacityReason">
          定員超過の理由{isFull || overBy > 0 ? '（定員を超えて受ける場合は必須）' : '（定員を超えるときだけ）'}
        </Label>
        <Input id="overCapacityReason" name="overCapacityReason" placeholder="例：常連様のため、ボートに余裕あり" />
      </div>
      {state.error && <Notice tone="error">{state.error}</Notice>}
      <Button type="submit" size="lg" disabled={pending || !hydrated} className="w-full sm:w-auto">
        {pending ? '登録中…' : '予約を登録'}
      </Button>
    </form>
  );
}
