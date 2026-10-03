'use client';

import { useId, useState, type ReactNode } from 'react';
import { ConfirmDialog } from '@/components/backoffice/confirm-dialog';
import { Input } from '@/components/ui/input';
import { formatYen } from '@/lib/format';

export type ItemsChangePrice = {
  id: string;
  label: string;
  /** 計算に使う単価（予約にある区分は予約のときの単価、新しく足す区分はこの回の日付の料金） */
  unitPrice: number;
  /** 予約のときの単価が、今の料金と違う */
  bookedPriceDiffers: boolean;
  /** 今の数 */
  quantity: number;
};

type Props = {
  action: (formData: FormData) => void | Promise<void>;
  backField: ReactNode;
  prices: ItemsChangePrice[];
  /** 今の人数の内訳（例：大人 2名・子ども 1名） */
  currentParty: string;
  currentTotal: number;
  unit: string;
  /** 人数で数えるプランか（貸切は乗船人数も入れる） */
  perPerson: boolean;
  guestCount: number | null;
  /** 貸切の基本料金に含まれる人数と、超えた 1 名あたりの追加料金（なければ null） */
  extraGuest: { included: number; price: number } | null;
  /** 定員超過の理由の欄を出すか（催行済みの実績の直しでは出さない） */
  showOverCapacity: boolean;
  /** 料金表の説明・今の料金表にない区分の注意 */
  notes: ReactNode;
  /** 確かめのダイアログに出す、支払いへの影響・事業者の回答・事業者へのメール */
  confirmNotes: ReactNode;
};

/**
 * 予約の詳細の「人数・料金の変更」の入力。料金と事業者へのメールに関わるので、変える前と後の人数・合計を
 * ダイアログで見せてから保存する（日時の変更と同じ）
 */
export function ItemsChangeForm({
  action,
  backField,
  prices,
  currentParty,
  currentTotal,
  unit,
  perPerson,
  guestCount,
  extraGuest,
  showOverCapacity,
  notes,
  confirmNotes,
}: Props) {
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(prices.map((p) => [p.id, p.quantity])),
  );
  const [guests, setGuests] = useState(guestCount === null ? '' : String(guestCount));
  const hintId = useId();
  const partySize = prices.reduce((sum, p) => sum + (quantities[p.id] ?? 0), 0);
  const guestNumber = Number(guests);
  const guestsValid = perPerson || (guests.trim() !== '' && Number.isInteger(guestNumber) && guestNumber >= 1);
  const extraAmount =
    !perPerson && extraGuest && guestsValid ? Math.max(0, guestNumber - extraGuest.included) * extraGuest.price : 0;
  const newTotal = prices.reduce((sum, p) => sum + p.unitPrice * (quantities[p.id] ?? 0), 0) + extraAmount;
  const newParty = prices
    .filter((p) => (quantities[p.id] ?? 0) > 0)
    .map((p) => `${p.label} ${quantities[p.id]}${unit}`)
    .join('・');
  // 入力が足りないときは押せなくする（ダイアログを開いている間は、背面の入力不足をブラウザが知らせられないため）
  const blocked =
    partySize === 0 ? '人数を 1 以上にしてください。' : !guestsValid ? '乗船人数を入れてください。' : null;
  const diff = newTotal - currentTotal;

  return (
    <form action={action} className="mt-1 space-y-3">
      {backField}
      {notes}
      <div className="grid gap-2 sm:grid-cols-2">
        {prices.map((p) => (
          <label
            key={p.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2"
          >
            <span>
              <span className="block font-medium">{p.label}</span>
              <span className="text-xs text-slate-600 tabular-nums">
                {formatYen(p.unitPrice)}
                {p.bookedPriceDiffers && '（予約のときの単価）'}
              </span>
            </span>
            <Input
              name={`qty.${p.id}`}
              type="number"
              inputMode="numeric"
              min={0}
              max={500}
              value={quantities[p.id] ?? 0}
              onChange={(event) =>
                setQuantities((q) => ({
                  ...q,
                  [p.id]: Math.max(0, Math.min(500, Math.floor(Number(event.target.value)) || 0)),
                }))
              }
              className="w-20 text-right tabular-nums"
              aria-label={`${p.label}の${perPerson ? '人数' : '数'}`}
            />
          </label>
        ))}
      </div>
      {!perPerson && (
        <label className="block space-y-1">
          <span className="block">乗船人数（必須）</span>
          <Input
            name="guestCount"
            type="number"
            inputMode="numeric"
            min={1}
            max={200}
            required
            value={guests}
            onChange={(event) => setGuests(event.target.value)}
            className="w-24 tabular-nums"
          />
        </label>
      )}
      <label className="block space-y-1">
        <span className="block">変更の理由（履歴に残します）</span>
        <Input name="reason" maxLength={200} placeholder="例：お客様から電話で 1 名追加" />
      </label>
      {showOverCapacity && (
        <label className="block space-y-1">
          <span className="block">定員超過の理由（定員を超えて受けるときだけ）</span>
          <Input name="overCapacityReason" maxLength={200} />
        </label>
      )}
      <ConfirmDialog
        tone="default"
        triggerLabel="人数・料金を変更"
        disabled={Boolean(blocked)}
        describedBy={blocked ? hintId : undefined}
        title="人数・料金を変更しますか？"
        confirmLabel="人数・料金を変更"
        pendingLabel="保存中…"
      >
        <dl className="grid grid-cols-[4rem_1fr] gap-x-3 gap-y-1 rounded-lg bg-slate-50 p-3 tabular-nums">
          <dt className="text-slate-600">今</dt>
          <dd>
            {currentParty}
            {!perPerson && guestCount !== null && `（乗船 ${guestCount}名）`}・{formatYen(currentTotal)}
          </dd>
          <dt className="text-slate-600">変更後</dt>
          <dd className="font-semibold">
            {newParty}
            {!perPerson && guestsValid && `（乗船 ${guestNumber}名）`}・{formatYen(newTotal)}
            {diff !== 0 && (
              <span className="block text-xs font-normal text-slate-700">
                料金が {formatYen(Math.abs(diff))} {diff > 0 ? '増えます' : '減ります'}
              </span>
            )}
          </dd>
        </dl>
        {confirmNotes}
      </ConfirmDialog>
      {blocked && (
        <p id={hintId} className="text-xs text-slate-600">
          {blocked}
        </p>
      )}
    </form>
  );
}
