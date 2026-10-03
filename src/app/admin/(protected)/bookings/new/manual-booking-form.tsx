'use client';

import { Minus, Plus } from 'lucide-react';
import { startTransition, useActionState, useState, type FormEvent } from 'react';
import { ErrorSummary } from '@/components/backoffice/form-kit';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatYen } from '@/lib/format';
import { normalizeYenInput } from '@/lib/yen';
import type { FormIssue } from '@/lib/zod-ja';
import { submitManualBooking, type ManualBookingState } from './actions';
import { useHydrated } from '@/lib/use-hydrated';
import { isPerPerson } from '@/modules/catalog/capacity-unit';

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
  /** お問い合わせから作るときの、お客様の連絡先の初期値 */
  initialCustomer?: { name: string; phone: string; email: string };
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

/** 受付完了・支払案内・予約確定のどのメールを送るか（登録する状態ごと） */
const MAIL_KIND = { requested: '受付完了', awaiting_payment: '支払案内', confirmed: '予約確定' } as const;

/**
 * 電話・LINE・店頭で受けた予約の入力。電話を受けながら入れやすいよう、人数 → お客様 → 支払方法 → 状態の順に並べ、
 * 下に固定した帯に合計と「予約を登録」を出す（長い入力欄を下までたどらなくても登録できる）
 */
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
  initialCustomer,
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
  // 支払方法を変えたために、登録する状態を自動で変えたときの知らせ（黙って変えない）
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  // 送る前に画面で見つけた入力の不足（サーバーへ送らずに知らせる）
  const [localIssues, setLocalIssues] = useState<FormIssue[] | null>(null);
  // 入金額：手で直すまでは料金の合計に合わせる
  const [paidInput, setPaidInput] = useState<string | null>(null);
  const guestNumber = Number(guests);
  const extraGuests =
    !isPerPerson(unit) && includedGuests && extraGuestPrice && Number.isInteger(guestNumber)
      ? Math.max(0, guestNumber - includedGuests)
      : 0;
  const extraAmount = extraGuests * (extraGuestPrice ?? 0);
  const baseTotal = prices.reduce((sum, p) => sum + p.price * (quantities[p.id] ?? 0), 0);
  const total = baseTotal + extraAmount;
  const overBy = partySize - remaining;
  const setQuantity = (id: string, value: number) =>
    setQuantities((q) => ({ ...q, [id]: Math.max(0, Math.min(500, Math.floor(value) || 0)) }));

  const error = localIssues ? '入力内容を確認してください。' : state.error;
  const issues = localIssues ?? state.issues;
  const invalid = new Set((issues ?? []).map((i) => i.field));
  const invalidProps = (field: string) => (invalid.has(field) ? { 'aria-invalid': true as const } : {});
  const statusLabel = STATUSES.find(([value]) => value === status)?.[1] ?? '';

  // form の action 属性を使うと送信後に入力がリセットされるため、onSubmit から呼ぶ
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    // サーバーでも確かめるが、よくある入れ忘れはその場で知らせる（入力は消さない）
    const found: FormIssue[] = [];
    if (partySize === 0) found.push({ field: 'quantities', message: '人数：1 名以上にしてください' });
    if (!String(formData.get('phone') ?? '').trim() && !String(formData.get('email') ?? '').trim()) {
      found.push({ field: 'phone', message: '電話番号・メールアドレス：どちらかを入力してください' });
    }
    if (found.length > 0) {
      setLocalIssues(found);
      return;
    }
    setLocalIssues(null);
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
              className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 has-checked:border-sky-600 has-checked:bg-sky-50 has-checked:font-semibold pointer-coarse:min-h-11"
            >
              <input type="radio" name="source" value={value} defaultChecked={i === 0} /> {label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset id="quantities" tabIndex={-1} className="space-y-2 outline-none">
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
                    {...invalidProps('quantities')}
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
        {isPerPerson(unit) && partySize > 0 && partySize < minPartySize && (
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

      {!isPerPerson(unit) && (
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
              {...invalidProps('guestCount')}
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

      <fieldset className="space-y-3">
        <legend className="font-semibold">代表者</legend>
        <div className="space-y-1">
          <Label htmlFor="name">お名前（必須）</Label>
          <Input
            id="name"
            name="name"
            required
            autoComplete="off"
            defaultValue={initialCustomer?.name}
            {...invalidProps('name')}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="phone">電話番号</Label>
            <Input
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              defaultValue={initialCustomer?.phone}
              {...invalidProps('phone')}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="email">メールアドレス</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="off"
              defaultValue={initialCustomer?.email}
              {...invalidProps('email')}
            />
          </div>
        </div>
        <p className="text-xs text-slate-500">電話番号かメールアドレスのどちらかは必須です。</p>
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
                  // 現地払いは支払案内を送らない（確認が済んだら予約確定で登録する）
                  if (value === 'onsite' && status === 'awaiting_payment') {
                    setStatus('requested');
                    setStatusNotice('現地払いでは支払案内を送らないため、登録する状態を「仮受付」に変えました。');
                  }
                }}
              />
              {label}
            </label>
          ))}
        </div>
        {method === 'onsite' && (
          <p className="text-xs text-slate-600">当日、事業者が現地で受け取ります。組合の入金確認はいりません。</p>
        )}
      </fieldset>

      <fieldset id="initialStatus" tabIndex={-1} className="space-y-2 outline-none">
        <legend className="font-semibold">登録する状態</legend>
        {statusNotice && (
          <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950">
            {statusNotice}
          </p>
        )}
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
                onChange={() => {
                  setStatus(value);
                  setStatusNotice(null);
                }}
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
        <legend className="font-semibold">
          <label htmlFor="operatorId">実施事業者{status !== 'requested' && '（必須）'}</label>
        </legend>
        <select
          id="operatorId"
          name="operatorId"
          defaultValue={defaultOperatorId ?? ''}
          required={status !== 'requested'}
          className="h-11 w-full rounded-lg border border-input bg-white px-2.5 text-sm"
          {...invalidProps('operatorId')}
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
            <input
              id="operatorConfirmed"
              type="checkbox"
              name="operatorConfirmed"
              value="on"
              required
              className="mt-0.5 size-4"
            />
            <span>
              <span className="block font-medium">実施事業者に受入を確認しました（電話など）</span>
              <span className="block text-xs text-slate-700">
                支払待ち・予約確定で登録するときは、確認したことを履歴に残します。
              </span>
            </span>
          </label>
        )}
      </fieldset>

      {status === 'confirmed' && method === 'online' && (
        <fieldset className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
          <legend className="sr-only">入金の記録</legend>
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
                {...invalidProps('paymentAmount')}
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
                {...invalidProps('paymentReceivedOn')}
              />
            </div>
          </div>
          {paidInput !== null && Number(normalizeYenInput(paidInput)) !== total && (
            <p role="status" className="text-xs font-semibold text-amber-900">
              料金の合計 {formatYen(total)} と違う金額です。
            </p>
          )}
          <div className="space-y-1">
            <Label htmlFor="paymentNote">入金のメモ（振込名義など・任意）</Label>
            <Input id="paymentNote" name="paymentNote" maxLength={200} className="bg-white" />
          </div>
        </fieldset>
      )}

      <fieldset className="space-y-2 text-sm">
        <legend className="font-semibold">お知らせ</legend>
        <label className="flex min-h-9 items-center gap-2 pointer-coarse:min-h-11">
          <input type="checkbox" name="sendEmail" defaultChecked className="size-4" />
          メールアドレスがあれば、{MAIL_KIND[status]}のメールを送る
        </label>
        {status === 'confirmed' && (
          <label className="flex min-h-9 items-center gap-2 pointer-coarse:min-h-11">
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
            <Input
              id="participantAges"
              name="participantAges"
              maxLength={200}
              placeholder="例：40歳、38歳、9歳"
              {...invalidProps('participantAges')}
            />
          </div>
        )}
        <div className="space-y-1">
          <Label htmlFor="customerNote">お客様からの連絡事項</Label>
          <Input id="customerNote" name="customerNote" maxLength={1000} />
        </div>
      </fieldset>

      <div className="space-y-1">
        <Label htmlFor="overCapacityReason">
          定員超過の理由{isFull || overBy > 0 ? '（定員を超えて受ける場合は必須）' : '（定員を超えるときだけ）'}
        </Label>
        <Input
          id="overCapacityReason"
          name="overCapacityReason"
          placeholder="例：常連様のため、ボートに余裕あり"
          {...invalidProps('overCapacityReason')}
        />
      </div>

      {/* 画面の下に固定：合計・登録する状態と「予約を登録」。エラーもここにまとめて出す */}
      <div className="sticky bottom-0 z-20 -mx-4 -mb-4 space-y-2 rounded-b-xl border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:-mx-5 md:-mb-5 md:px-5">
        <ErrorSummary error={error} issues={issues} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-700" aria-live="polite">
            <span className="font-semibold text-slate-900 tabular-nums">
              {partySize}
              {unit} ・ {formatYen(total)}
            </span>
            <span className="block text-xs text-slate-600">「{statusLabel}」で登録します</span>
          </p>
          <Button type="submit" size="lg" disabled={pending || !hydrated} className="min-w-36">
            {pending ? '登録中…' : '予約を登録'}
          </Button>
        </div>
      </div>
    </form>
  );
}
