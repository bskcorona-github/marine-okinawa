'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState, startTransition, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatYen } from '@/lib/format';
import { submitBooking, type SubmitBookingState } from './actions';

type Props = {
  locale: string;
  slotId: string;
  prices: { id: string; label: string; price: number }[];
  unit: string;
  maxPartySize: number;
};

export function BookingForm({ locale, slotId, prices, unit, maxPartySize }: Props) {
  const t = useTranslations('booking');
  const [state, formAction, pending] = useActionState<SubmitBookingState, FormData>(submitBooking, { error: null });
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const total = prices.reduce((sum, p) => sum + p.price * (quantities[p.id] ?? 0), 0);

  // form の action 属性を使うと送信後に入力がリセットされるため、onSubmit から呼ぶ
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate={false}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="slotId" value={slotId} />

      <fieldset className="space-y-3 rounded-lg border bg-white p-4">
        <legend className="px-1 font-semibold">{t('people')}</legend>
        {prices.map((price) => (
          <div key={price.id} className="flex items-center justify-between gap-4">
            <Label htmlFor={`qty-${price.id}`}>
              {price.label}（{formatYen(price.price)}）
            </Label>
            <Input
              id={`qty-${price.id}`}
              name={`qty.${price.id}`}
              type="number"
              inputMode="numeric"
              min={0}
              max={maxPartySize}
              defaultValue={0}
              className="w-24 text-right"
              onChange={(e) => setQuantities((q) => ({ ...q, [price.id]: Number(e.target.value) || 0 }))}
            />
          </div>
        ))}
        <p className="text-xs text-slate-500">{t('peopleHint', { max: maxPartySize, unit })}</p>
        <p className="text-right font-semibold">
          {t('total')}：<span data-testid="total">{formatYen(total)}</span>
        </p>
      </fieldset>

      <fieldset className="space-y-3 rounded-lg border bg-white p-4">
        <legend className="px-1 font-semibold">{t('contact')}</legend>
        <div className="space-y-1">
          <Label htmlFor="name">{t('name')}</Label>
          <Input id="name" name="name" autoComplete="name" required maxLength={100} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="email">{t('email')}</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="emailConfirm">{t('emailConfirm')}</Label>
          <Input id="emailConfirm" name="emailConfirm" type="email" autoComplete="off" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="phone">{t('phone')}</Label>
          <Input id="phone" name="phone" type="tel" autoComplete="tel" required />
          <p className="text-xs text-slate-500">{t('phoneHint')}</p>
        </div>
      </fieldset>

      <p className="rounded-md bg-cyan-50 p-3 text-sm text-cyan-900">{t('paymentOnsite')}</p>

      {state.error && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {t(`errors.${state.error}`)}
        </p>
      )}

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? t('submitting') : t('submit')}
      </Button>
    </form>
  );
}
