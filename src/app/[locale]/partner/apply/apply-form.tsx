'use client';

import { CheckCircle2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { startTransition, useActionState, useState, type FormEvent, type ReactNode } from 'react';
import { Phrase } from '@/components/site/phrase';
import { FileInput } from '@/components/admin/file-input';
import { Link } from '@/i18n/navigation';
import { isInvoiceNumber, normalizeInvoiceNumber } from '@/lib/invoice-number';
import { useHydrated } from '@/lib/use-hydrated';
import { cn } from '@/lib/utils';
import { submitApplication, type ApplyState } from './actions';
import { MAX_FILES_PER_FIELD, MAX_TOTAL_UPLOAD } from './limits';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INPUT =
  'w-full rounded-xl border bg-white px-4 text-[16px] text-ink placeholder:text-ink/45 focus:ring-3 focus:outline-none';
const inputClass = (invalid: boolean) =>
  cn(INPUT, invalid ? 'border-red-500 focus:ring-red-200' : 'border-ocean/20 focus:border-lagoon focus:ring-lagoon/25');

type TextField =
  | 'companyName'
  | 'representative'
  | 'address'
  | 'contactName'
  | 'phone'
  | 'email'
  | 'emailConfirm'
  | 'emergencyPhone'
  | 'invoiceNumber'
  | 'planInfo'
  | 'message';
type Field = TextField | 'agree' | 'files' | 'fileInsurance' | 'fileLicense' | 'fileOther';

const REQUIRED = ['companyName', 'contactName', 'phone', 'email', 'emailConfirm', 'planInfo'] as const;
const isRequired = (field: TextField) => (REQUIRED as readonly string[]).includes(field);
const FILES = ['fileInsurance', 'fileLicense', 'fileOther'] as const;

function Label({
  htmlFor,
  children,
  required,
  t,
}: {
  htmlFor: string;
  children: ReactNode;
  required: boolean;
  t: (k: 'required' | 'optional') => string;
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
          required ? 'bg-coral-strong/10 text-coral-deep' : 'bg-ink/5 text-ink/60',
        )}
      >
        {required ? t('required') : t('optional')}
      </span>
    </div>
  );
}

export function ApplyForm() {
  const t = useTranslations('partnerApply');
  const [state, formAction, pending] = useActionState<ApplyState, FormData>(submitApplication, { error: null });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const hydrated = useHydrated();
  // 添付の欄ごとの大きさ（合計の上限を、送る前に画面で知らせる）
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const totalSize = Object.values(sizes).reduce((sum, n) => sum + n, 0);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const v = (name: string) => String(data.get(name) ?? '').trim();
    const next: Partial<Record<Field, string>> = {};
    for (const field of REQUIRED) {
      if (!v(field)) next[field] = t(`validation.${field}`);
    }
    if (v('email') && !EMAIL.test(v('email'))) next.email = t('validation.email');
    if (v('email') && v('emailConfirm') && v('email').toLowerCase() !== v('emailConfirm').toLowerCase()) {
      next.emailConfirm = t('validation.emailConfirm');
    }
    // 全角・ハイフン・小文字の t は、サーバーで直して受け付ける
    const invoice = normalizeInvoiceNumber(v('invoiceNumber'));
    if (invoice && !isInvoiceNumber(invoice)) next.invoiceNumber = t('validation.invoiceNumber');
    if (totalSize > MAX_TOTAL_UPLOAD) next.files = t('errors.FILES_TOO_LARGE');
    if (data.get('agree') !== 'on') next.agree = t('errors.AGREEMENT_REQUIRED');
    setErrors(next);
    const first = (Object.keys(next) as Field[])[0];
    if (first) {
      form.querySelector<HTMLElement>(`#apply-${first}`)?.focus();
      return;
    }
    startTransition(() => formAction(data));
  }

  if (state.done) {
    return (
      <div className="space-y-4 rounded-3xl bg-white p-6 text-center ring-1 ring-ocean/10 sm:p-8" role="status">
        <CheckCircle2 aria-hidden className="mx-auto size-12 text-lagoon" />
        <h2 className="font-heading text-xl font-bold text-ocean">{t('doneTitle')}</h2>
        <p className="jp-wrap text-sm leading-relaxed text-ink/80">
          <Phrase>{t('doneLead')}</Phrase>
        </p>
        <Link
          href="/"
          className="inline-flex min-h-12 items-center rounded-xl bg-ocean px-5 font-bold text-white hover:bg-ocean-deep"
        >
          {t('backHome')}
        </Link>
      </div>
    );
  }

  const serverField = state.error && state.field ? (state.field as Field) : null;
  const errorOf = (field: Field) => errors[field] ?? (serverField === field ? t(`errors.${state.error!}`) : undefined);
  const HINTS: Partial<Record<TextField, string>> = {
    phone: t('phoneHint'),
    emergencyPhone: t('emergencyPhoneHint'),
    invoiceNumber: t('invoiceHint'),
  };
  const describe = (field: Field, hint?: boolean) =>
    errorOf(field) ? `apply-${field}-error` : hint ? `apply-${field}-hint` : undefined;
  const errorText = (field: Field) =>
    errorOf(field) && (
      <p id={`apply-${field}-error`} className="jp-wrap text-sm font-medium text-red-700">
        <Phrase>{errorOf(field) ?? ''}</Phrase>
      </p>
    );
  const text = (
    field: TextField,
    props: {
      type?: string;
      autoComplete?: string;
      maxLength: number;
      inputMode?: 'tel' | 'email';
      placeholder?: string;
    },
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={`apply-${field}`} required={isRequired(field)} t={t}>
        {t(field)}
      </Label>
      <input
        id={`apply-${field}`}
        name={field}
        type={props.type ?? 'text'}
        autoComplete={props.autoComplete}
        inputMode={props.inputMode}
        maxLength={props.maxLength}
        placeholder={props.placeholder}
        aria-required={isRequired(field) || undefined}
        aria-invalid={Boolean(errorOf(field))}
        aria-describedby={describe(field, Boolean(HINTS[field]))}
        className={cn(inputClass(Boolean(errorOf(field))), 'h-12')}
      />
      {HINTS[field] && !errorOf(field) && (
        <p id={`apply-${field}-hint`} className="jp-wrap text-xs text-ink/70">
          <Phrase>{HINTS[field]}</Phrase>
        </p>
      )}
      {errorText(field)}
    </div>
  );

  return (
    <form
      method="post"
      onSubmit={onSubmit}
      noValidate
      className="space-y-6 rounded-3xl bg-white p-5 ring-1 ring-ocean/10 sm:p-6"
    >
      <fieldset className="space-y-4">
        <legend className="font-heading text-lg font-bold text-ocean">{t('company')}</legend>
        {text('companyName', { autoComplete: 'organization', maxLength: 100 })}
        <div className="grid gap-4 sm:grid-cols-2">
          {text('representative', { maxLength: 60 })}
          {text('contactName', { autoComplete: 'name', maxLength: 60 })}
        </div>
        {text('address', { autoComplete: 'street-address', maxLength: 200 })}
        <div className="grid gap-4 sm:grid-cols-2">
          {text('email', { type: 'email', autoComplete: 'email', inputMode: 'email', maxLength: 254 })}
          {text('emailConfirm', { type: 'email', autoComplete: 'off', inputMode: 'email', maxLength: 254 })}
          {text('phone', {
            type: 'tel',
            autoComplete: 'tel',
            inputMode: 'tel',
            maxLength: 30,
            placeholder: t('phonePlaceholder'),
          })}
          {text('emergencyPhone', { type: 'tel', inputMode: 'tel', maxLength: 30, placeholder: t('phonePlaceholder') })}
          {text('invoiceNumber', { maxLength: 20, placeholder: 'T1234567890123' })}
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="font-heading text-lg font-bold text-ocean">{t('plan')}</legend>
        <div className="space-y-1.5">
          <Label htmlFor="apply-planInfo" required t={t}>
            {t('planInfo')}
          </Label>
          <p id="apply-planInfo-hint" className="jp-wrap text-xs text-ink/70">
            <Phrase>{t('planInfoHint')}</Phrase>
          </p>
          <textarea
            id="apply-planInfo"
            name="planInfo"
            rows={6}
            maxLength={5000}
            placeholder={t('planInfoPlaceholder')}
            aria-required
            aria-invalid={Boolean(errorOf('planInfo'))}
            aria-describedby={describe('planInfo', true)}
            className={cn(inputClass(Boolean(errorOf('planInfo'))), 'py-3 leading-relaxed')}
          />
          {errorText('planInfo')}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="apply-message" required={false} t={t}>
            {t('message')}
          </Label>
          <textarea
            id="apply-message"
            name="message"
            rows={3}
            maxLength={2000}
            className={cn(inputClass(false), 'py-3 leading-relaxed')}
          />
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="font-heading text-lg font-bold text-ocean">{t('files')}</legend>
        <p className="jp-auto text-sm text-ink/75">
          {t('filesLead')}
          {t('filesMultiple', { max: MAX_FILES_PER_FIELD })}
        </p>
        {FILES.map((name) => (
          <div key={name} className="space-y-1.5 pt-1">
            <p className="flex items-center gap-2 text-sm font-semibold">
              {t(name)}
              <span aria-hidden className="rounded bg-ink/5 px-1.5 py-0.5 text-[11px] font-bold text-ink/60">
                {t('optional')}
              </span>
            </p>
            <FileInput
              name={name}
              label={t(name)}
              multiple
              tone="site"
              invalid={Boolean(errorOf(name))}
              describedBy={errorOf(name) ? `apply-${name}-error` : undefined}
              onChange={(bytes) => {
                setSizes((current) => ({ ...current, [name]: bytes }));
                setErrors((e) => ({ ...e, [name]: undefined, files: undefined }));
              }}
            />
            {errorText(name)}
          </div>
        ))}
        {/* 合計は、ファイルを選んでから出す */}
        {totalSize > 0 && (
          <p
            className={cn(
              'text-xs tabular-nums',
              totalSize > MAX_TOTAL_UPLOAD ? 'font-semibold text-red-700' : 'text-ink/70',
            )}
          >
            {t('filesTotal', { size: `${(totalSize / 1024 / 1024).toFixed(1)}MB` })}
          </p>
        )}
        {errorText('files')}
      </fieldset>

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
            errorOf('agree') ? 'bg-red-50 ring-red-300' : 'ring-ocean/10',
          )}
        >
          <input
            id="apply-agree"
            type="checkbox"
            name="agree"
            value="on"
            aria-invalid={Boolean(errorOf('agree'))}
            aria-describedby={describe('agree')}
            onChange={() => setErrors((e) => ({ ...e, agree: undefined }))}
            className="mt-0.5 size-5 shrink-0 accent-ocean"
          />
          <span className="font-medium">{t('agree')}</span>
        </label>
        {errorText('agree')}
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
