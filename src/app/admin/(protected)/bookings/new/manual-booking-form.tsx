'use client';

import { startTransition, useActionState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatYen } from '@/lib/format';
import { submitManualBooking, type ManualBookingState } from './actions';

type Props = {
  slotId: string;
  prices: { id: string; label: string; price: number }[];
  isFull: boolean;
};

export function ManualBookingForm({ slotId, prices, isFull }: Props) {
  const [state, formAction, pending] = useActionState<ManualBookingState, FormData>(submitManualBooking, {
    error: null,
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-5 rounded-lg border bg-white p-4">
      <input type="hidden" name="slotId" value={slotId} />
      <fieldset className="space-y-2">
        <legend className="font-semibold">予約元</legend>
        <div className="flex gap-4 text-sm">
          {[
            ['phone', '電話'],
            ['line', 'LINE'],
            ['walk_in', '店頭'],
          ].map(([value, label], i) => (
            <label key={value} className="flex items-center gap-1">
              <input type="radio" name="source" value={value} defaultChecked={i === 0} /> {label}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="font-semibold">人数</legend>
        {prices.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-4">
            <Label htmlFor={`qty-${p.id}`}>
              {p.label}（{formatYen(p.price)}）
            </Label>
            <Input
              id={`qty-${p.id}`}
              name={`qty.${p.id}`}
              type="number"
              min={0}
              defaultValue={0}
              className="w-24 text-right"
            />
          </div>
        ))}
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="font-semibold">代表者</legend>
        <div className="space-y-1">
          <Label htmlFor="name">お名前（必須）</Label>
          <Input id="name" name="name" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="phone">電話番号</Label>
          <Input id="phone" name="phone" type="tel" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="email">メールアドレス</Label>
          <Input id="email" name="email" type="email" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="sendEmail" defaultChecked /> メールアドレスがあれば予約完了メールを送る
        </label>
        <p className="text-xs text-slate-500">電話番号かメールアドレスのどちらかは必須です。</p>
      </fieldset>
      <div className="space-y-1">
        <Label htmlFor="overCapacityReason">
          定員超過の理由{isFull ? '（満席のため、受ける場合は必須）' : '（満席時のみ）'}
        </Label>
        <Input id="overCapacityReason" name="overCapacityReason" placeholder="例：常連様のため、ボートに余裕あり" />
      </div>
      {state.error && (
        <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        予約を登録
      </Button>
    </form>
  );
}
