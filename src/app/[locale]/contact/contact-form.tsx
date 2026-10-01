'use client';

import { CheckCircle2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { startTransition, useActionState, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import { useHydrated } from '@/lib/use-hydrated';
import { cn } from '@/lib/utils';
import { submitInquiry, type ContactState } from './actions';

const KINDS = ['booking', 'group', 'partner', 'other'] as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INPUT =
  'w-full rounded-xl border bg-white px-4 text-[16px] text-ink placeholder:text-ink/45 focus:ring-3 focus:outline-none';
const inputClass = (invalid: boolean) =>
  cn(INPUT, invalid ? 'border-red-500 focus:ring-red-200' : 'border-ocean/20 focus:border-lagoon focus:ring-lagoon/25');

type Field = 'name' | 'email' | 'message' | 'agree';

function Label({
  htmlFor,
  children,
  badge,
  tone,
}: {
  htmlFor: string;
  children: ReactNode;
  badge: string;
  tone: 'required' | 'optional';
}) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={htmlFor} className="text-sm font-semibold">
        {children}
      </label>
      <span
        aria-hidden
        className={cn(
          'rounded px-1.5 py-0.5 text-[11px] font-bold',
          tone === 'required' ? 'bg-coral-strong/10 text-coral-deep' : 'bg-ink/5 text-ink/60',
        )}
      >
        {badge}
      </span>
    </div>
  );
}

export function ContactForm({ initialKind }: { initialKind: (typeof KINDS)[number] }) {
  const t = useTranslations('contact');
  const [state, formAction, pending] = useActionState<ContactState, FormData>(submitInquiry, { error: null });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [kind, setKind] = useState<(typeof KINDS)[number]>(initialKind);
  const hydrated = useHydrated();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const v = (name: string) => String(data.get(name) ?? '').trim();
    const next: Partial<Record<Field, string>> = {};
    if (!v('name')) next.name = t('validation.name');
    if (!EMAIL.test(v('email'))) next.email = t('validation.email');
    if (!v('message')) next.message = t('validation.message');
    if (data.get('agree') !== 'on') next.agree = t('errors.AGREEMENT_REQUIRED');
    setErrors(next);
    const first = (Object.keys(next) as Field[])[0];
    if (first) {
      form.querySelector<HTMLElement>(`#contact-${first}`)?.focus();
      return;
    }
    startTransition(() => formAction(data));
  }

  if (state.done) {
    return (
      <div className="space-y-4 rounded-3xl bg-white p-6 text-center ring-1 ring-ocean/10 sm:p-8" role="status">
        <CheckCircle2 aria-hidden className="mx-auto size-12 text-lagoon" />
        <h2 className="font-heading text-xl font-bold text-ocean">{t('doneTitle')}</h2>
        <p className="jp-auto text-sm leading-relaxed text-ink/80">{t('doneLead')}</p>
        <Link
          href="/"
          className="inline-flex min-h-12 items-center rounded-xl bg-ocean px-5 font-bold text-white hover:bg-ocean-deep"
        >
          {t('backHome')}
        </Link>
      </div>
    );
  }

  const error = (field: Field) =>
    errors[field] && (
      <p id={`contact-${field}-error`} className="jp-auto text-sm font-medium text-red-700">
        {errors[field]}
      </p>
    );

  return (
    <form
      method="post"
      onSubmit={onSubmit}
      noValidate
      className="space-y-5 rounded-3xl bg-white p-5 ring-1 ring-ocean/10 sm:p-6"
    >
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-semibold">{t('kind')}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {KINDS.map((value) => (
            <label
              key={value}
              className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-3 ring-1 ring-ocean/15 has-checked:bg-foam has-checked:ring-2 has-checked:ring-lagoon"
            >
              <input
                type="radio"
                name="kind"
                value={value}
                checked={kind === value}
                onChange={() => setKind(value)}
                className="size-5 shrink-0 accent-ocean"
              />
              <span className="jp-auto text-sm font-medium">{t(`kinds.${value}`)}</span>
            </label>
          ))}
        </div>
        {kind === 'partner' && (
          <p className="jp-auto rounded-2xl bg-foam p-3 text-sm text-ocean">
            {t('partnerApply')}{' '}
            <Link href="/partner/apply" className="font-semibold underline underline-offset-4">
              {t('partnerApplyLink')}
            </Link>
          </p>
        )}
      </fieldset>

      <div className="space-y-1.5">
        <Label htmlFor="contact-name" badge={t('required')} tone="required">
          {t('name')}
        </Label>
        <input
          id="contact-name"
          name="name"
          autoComplete="name"
          maxLength={100}
          aria-required
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? 'contact-name-error' : undefined}
          className={cn(inputClass(Boolean(errors.name)), 'h-12')}
        />
        {error('name')}
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="contact-email" badge={t('required')} tone="required">
            {t('email')}
          </Label>
          <input
            id="contact-email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            maxLength={254}
            aria-required
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? 'contact-email-error' : undefined}
            className={cn(inputClass(Boolean(errors.email)), 'h-12')}
          />
          {error('email')}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contact-phone" badge={t('optional')} tone="optional">
            {t('phone')}
          </Label>
          <input
            id="contact-phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            maxLength={30}
            className={cn(inputClass(false), 'h-12')}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="contact-message" badge={t('required')} tone="required">
          {t('message')}
        </Label>
        <textarea
          id="contact-message"
          name="message"
          rows={6}
          maxLength={3000}
          placeholder={t('messagePlaceholder')}
          aria-required
          aria-invalid={Boolean(errors.message)}
          aria-describedby={errors.message ? 'contact-message-error' : 'contact-message-hint'}
          className={cn(inputClass(Boolean(errors.message)), 'py-3 leading-relaxed')}
        />
        {errors.message ? (
          error('message')
        ) : (
          <p id="contact-message-hint" className="jp-auto text-xs text-ink/70">
            {t('bookingNote')}
          </p>
        )}
      </div>

      {/* 機械的な送信を見分けるための欄（人には見えない・読み上げない） */}
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <div className="space-y-2">
        <p>
          <Link
            href="/privacy"
            target="_blank"
            className="jp-auto inline-block text-sm font-semibold text-lagoon-ink underline underline-offset-4 hover:text-ocean"
          >
            {t('privacyLink')}
          </Link>
        </p>
        <label
          className={cn(
            'flex cursor-pointer items-start gap-3 rounded-2xl p-3 text-sm ring-1',
            errors.agree ? 'bg-red-50 ring-red-300' : 'ring-ocean/10',
          )}
        >
          <input
            id="contact-agree"
            type="checkbox"
            name="agree"
            value="on"
            aria-invalid={Boolean(errors.agree)}
            aria-describedby={errors.agree ? 'contact-agree-error' : undefined}
            onChange={() => setErrors((e) => ({ ...e, agree: undefined }))}
            className="mt-0.5 size-5 shrink-0 accent-ocean"
          />
          <span className="font-medium">{t('agree')}</span>
        </label>
        {error('agree')}
      </div>

      {state.error && (
        <p role="alert" className="rounded-2xl bg-red-50 p-4 text-sm font-medium text-red-700">
          {t(`errors.${state.error}`)}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || !hydrated}
        className="flex min-h-14 w-full items-center justify-center rounded-2xl bg-ocean px-6 text-lg font-bold text-white transition hover:bg-ocean-deep disabled:opacity-60"
      >
        {pending ? t('submitting') : t('submit')}
      </button>
    </form>
  );
}
