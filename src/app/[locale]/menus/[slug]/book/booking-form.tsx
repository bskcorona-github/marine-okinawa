'use client';

import { Minus, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Phrase } from '@/components/site/phrase';
import { Link } from '@/i18n/navigation';
import { formatYen } from '@/lib/format';
import { useHydrated } from '@/lib/use-hydrated';
import { cn } from '@/lib/utils';
import { submitBooking, type SubmitBookingState } from './actions';
import { EMPTY_SELECTION, setBookingSelection } from './booking-total';

type Props = {
  locale: string;
  slotId: string;
  prices: { id: string; label: string; price: number; meetingPoint: string | null }[];
  unit: string;
  maxPartySize: number;
  /** 1 回の予約の最少人数（「2名から」など） */
  minPartySize: number;
  /** 最大人数が残り枠で決まっているとき true（案内の文言を「この回の残り」にする） */
  cappedByRemaining: boolean;
  initialPeople: number | null;
  /** 貸切：基本料金に含まれる人数と、超えた 1 名あたりの追加料金（なければ null） */
  includedGuests: number | null;
  extraGuestPrice: number | null;
  /** 貸切：乗船人数の上限（なければ null） */
  maxGuests: number | null;
  /** 貸切：検索で指定した人数（乗船人数の初期値） */
  initialGuests: number | null;
  /**
   * 「ご確認ください」に出す文面。日本語を文節で折り返すため、サーバー側で <Phrase> にしたものを受け取る
   * （BudouX の辞書をブラウザに送らないため、このコンポーネントでは組まない）
   */
  policy: ReactNode;
  weather: ReactNode;
  conditions: ReactNode;
  /** 注意事項（保護者の同意書・妊娠中の方など。同意の対象に入れる） */
  notes: ReactNode;
  /** 同意チェックの文言（同上） */
  agreeLabel: ReactNode;
  /** 年齢の条件があるプランは、参加者全員の年齢を入力してもらう */
  requireAges: boolean;
  /** 料金の見出し（設定の「お支払総額」など） */
  priceLabel: string;
  /** 申し込む回の日時（送信ボタンの前の合計に添える） */
  slotLabel: string;
};

type FieldName = 'people' | 'guestCount' | 'name' | 'email' | 'emailConfirm' | 'phone' | 'participantAges' | 'agree';
type Errors = Partial<Record<FieldName, string>>;

const INPUT =
  'h-12 w-full rounded-xl border bg-white px-4 text-[16px] text-ink placeholder:text-ink/45 focus:outline-none focus-visible:outline-none focus:ring-3';
const inputClass = (invalid: boolean) =>
  cn(INPUT, invalid ? 'border-red-500 focus:ring-red-200' : 'border-ocean/20 focus:border-lagoon focus:ring-lagoon/25');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9()\-\s]{10,20}$/;

function Field({
  id,
  label,
  required,
  optional,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  /** 必須の印の文言（任意の欄では optional を渡す） */
  required?: string;
  optional?: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="text-sm font-semibold">
          {label}
        </label>
        {/* 必須であることは入力欄の aria-required で伝える（ラベルの読み上げ名は項目名だけにする） */}
        {required ? (
          <span aria-hidden className="rounded bg-coral-strong/10 px-1.5 py-0.5 text-[11px] font-bold text-coral-deep">
            {required}
          </span>
        ) : (
          <span aria-hidden className="rounded bg-ink/5 px-1.5 py-0.5 text-[11px] font-bold text-ink/60">
            {optional}
          </span>
        )}
      </div>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="jp-wrap text-xs text-ink/70">
          <Phrase>{hint}</Phrase>
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="jp-wrap text-sm font-medium text-red-700">
          <Phrase>{error}</Phrase>
        </p>
      )}
    </div>
  );
}

export function BookingForm({
  locale,
  slotId,
  prices,
  unit,
  maxPartySize,
  minPartySize,
  cappedByRemaining,
  initialPeople,
  includedGuests,
  extraGuestPrice,
  maxGuests,
  initialGuests,
  policy,
  weather,
  conditions,
  notes,
  agreeLabel,
  requireAges,
  priceLabel,
  slotLabel,
}: Props) {
  const t = useTranslations('booking');
  const [state, formAction, pending] = useActionState<SubmitBookingState, FormData>(submitBooking, { error: null });
  const [errors, setErrors] = useState<Errors>({});
  const hydrated = useHydrated();
  const confirmRef = useRef<HTMLDivElement>(null);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const target = confirmRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(([entry]) => setConfirmVisible(entry.isIntersecting));
    observer.observe(target);
    // 画面の高さが大きく縮んだらキーボードが開いているとみなす
    const viewport = window.visualViewport;
    const onResize = () => setKeyboardOpen(Boolean(viewport && window.innerHeight - viewport.height > 150));
    viewport?.addEventListener('resize', onResize);
    return () => {
      observer.disconnect();
      viewport?.removeEventListener('resize', onResize);
    };
  }, []);
  // 定員を艇で数える貸切プランは、料金区分（コース・出発港）を 1 つ選び、乗船人数を別に入力する
  const charter = unit !== '名';
  // 検索で人数を指定してきた場合は、最初の料金区分にその人数を入れておく
  // （最少人数・最大人数の範囲に合わせる）
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    initialPeople && prices[0]
      ? { [prices[0].id]: Math.max(Math.min(initialPeople, maxPartySize), Math.min(minPartySize, maxPartySize)) }
      : {},
  );
  const [guests, setGuests] = useState(initialGuests ? String(initialGuests) : '');
  const partySize = Object.values(quantities).reduce((sum, n) => sum + n, 0);
  const baseTotal = prices.reduce((sum, p) => sum + p.price * (quantities[p.id] ?? 0), 0);
  // 貸切：基本の人数を超えた乗船人数の追加料金（サーバー側と同じ計算。合計に含めて事前に支払う）
  const guestNumber = Number(guests);
  const guestsOverMax = Boolean(charter && maxGuests && guestNumber > maxGuests);
  const extraGuests =
    charter && includedGuests && extraGuestPrice && Number.isInteger(guestNumber) && !guestsOverMax
      ? Math.max(0, guestNumber - includedGuests)
      : 0;
  const extraAmount = extraGuests * (extraGuestPrice ?? 0);
  const total = baseTotal + (partySize > 0 ? extraAmount : 0);
  const courseId = charter ? (prices.find((p) => (quantities[p.id] ?? 0) > 0)?.id ?? null) : null;
  // 予約内容のまとめ（PC の右側）にも合計と選んだコースを出す
  const guestsForSummary = charter && Number.isInteger(guestNumber) && guestNumber > 0 ? guestNumber : null;
  useEffect(
    () =>
      setBookingSelection({
        count: partySize,
        amount: total,
        courseId,
        guests: guestsForSummary,
        extraCount: partySize > 0 ? extraGuests : 0,
        extraAmount: partySize > 0 ? extraAmount : 0,
      }),
    [partySize, total, courseId, guestsForSummary, extraGuests, extraAmount],
  );
  // 別の回の予約画面へ移ったときに、前の選択が残らないようにする
  useEffect(() => () => setBookingSelection(EMPTY_SELECTION), []);
  const setQuantity = (id: string, value: number) => {
    setQuantities((q) => {
      const others = Object.entries(q).reduce((sum, [k, n]) => (k === id ? sum : sum + n), 0);
      return { ...q, [id]: Math.max(0, Math.min(value, maxPartySize - others)) };
    });
    setErrors((e) => ({ ...e, people: undefined }));
  };

  function validate(form: HTMLFormElement): Errors {
    const data = new FormData(form);
    const v = (name: string) => String(data.get(name) ?? '').trim();
    const next: Errors = {};
    if (partySize === 0) next.people = t(charter ? 'validation.charterOption' : 'validation.people');
    else if (!charter && partySize < minPartySize) next.people = t('validation.peopleMin', { min: minPartySize });
    const guests = Number(v('guestCount'));
    if (charter && !(Number.isInteger(guests) && guests >= 1 && guests <= 200)) {
      next.guestCount = t('validation.guestCount');
    } else if (charter && maxGuests && guests > maxGuests) {
      next.guestCount = t('validationGuestMax', { max: maxGuests });
    }
    if (!v('name')) next.name = t('validation.name');
    if (!v('email')) next.email = t('validation.emailRequired');
    else if (!EMAIL.test(v('email'))) next.email = t('validation.email');
    if (!v('emailConfirm')) next.emailConfirm = t('validation.emailConfirm');
    else if (v('email').toLowerCase() !== v('emailConfirm').toLowerCase())
      next.emailConfirm = t('errors.EMAIL_MISMATCH');
    if (!v('phone')) next.phone = t('validation.phoneRequired');
    else if (!PHONE.test(v('phone'))) next.phone = t('validation.phone');
    if (requireAges && !v('participantAges')) next.participantAges = t('validation.participantAges');
    if (data.get('agree') !== 'on') next.agree = t('errors.AGREEMENT_REQUIRED');
    return next;
  }

  // form の action 属性を使うと送信後に入力がリセットされるため、onSubmit から呼ぶ
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const found = validate(form);
    setErrors(found);
    const first = (Object.keys(found) as FieldName[])[0];
    if (first) {
      // 最初のエラー欄へ移動する（固定ヘッダーに隠れないよう scroll-padding を設定済み）
      const target =
        first === 'people'
          ? form.querySelector<HTMLElement>('[data-first-qty]')
          : form.querySelector<HTMLElement>(`#${first}`);
      target?.focus();
      return;
    }
    const formData = new FormData(form);
    startTransition(() => formAction(formData));
  }

  // 指定した欄だけを確認し直す。エラーは入力中に消し、新しいエラーは欄を離れたときだけ出す
  function recheck(form: HTMLFormElement | null, names: FieldName[]) {
    if (!form) return;
    const found = validate(form);
    setErrors((e) => ({ ...e, ...Object.fromEntries(names.map((n) => [n, found[n]])) }));
  }
  // 入力中：表示中のエラーが直ったらすぐ消す（メールアドレスを直したら確認用との一致も確認し直す）
  function onFix(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const name = event.currentTarget.name as FieldName;
    const targets = (name === 'email' ? [name, 'emailConfirm' as const] : [name]).filter((n) => errors[n]);
    if (targets.length > 0) recheck(event.currentTarget.form, targets);
  }
  // 確認用メールは欄を離れた時点で不一致を知らせる。ただし送信ボタンへ移るときは、
  // エラー表示の増減でボタンの位置がずれてクリックが外れないよう、送信時の確認に任せる
  function onConfirmBlur(event: FocusEvent<HTMLInputElement>) {
    const next = event.relatedTarget as HTMLElement | null;
    if (next?.getAttribute('type') === 'submit' || !event.currentTarget.value) return;
    recheck(event.currentTarget.form, ['emailConfirm']);
  }

  const describedBy = (id: FieldName, hint?: boolean) => (errors[id] ? `${id}-error` : hint ? `${id}-hint` : undefined);
  const hasErrors = Object.values(errors).some(Boolean);
  const FIELD_LABELS: Record<FieldName, string> = {
    people: t(charter ? 'charterOption' : 'people'),
    guestCount: t('guestCount'),
    name: t('name'),
    email: t('email'),
    emailConfirm: t('emailConfirm'),
    phone: t('phone'),
    participantAges: t('participantAges'),
    agree: t('agreeShort'),
  };
  const errorFields = (Object.keys(errors) as FieldName[])
    .filter((field) => errors[field])
    .map((field) => [field, FIELD_LABELS[field]] as const);

  return (
    <form method="post" onSubmit={onSubmit} className="space-y-6" noValidate>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="slotId" value={slotId} />

      <fieldset
        className={cn(
          'space-y-4 rounded-3xl bg-white p-5 ring-1 sm:p-6',
          errors.people ? 'ring-2 ring-red-400' : 'ring-ocean/10',
        )}
        aria-describedby={errors.people ? 'people-error' : undefined}
      >
        <legend className="float-left mb-2 w-full font-heading text-lg font-bold text-ocean">
          {t(charter ? 'charterOption' : 'people')}
        </legend>
        {charter ? (
          <div className="clear-both space-y-2">
            {prices.map((price, index) => {
              const checked = (quantities[price.id] ?? 0) > 0;
              return (
                <label
                  key={price.id}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-2xl p-4 ring-1 transition',
                    checked ? 'bg-foam ring-2 ring-lagoon' : 'ring-ocean/15 hover:ring-lagoon/60',
                  )}
                >
                  <input
                    type="radio"
                    name="charterOption"
                    value={price.id}
                    checked={checked}
                    data-first-qty={index === 0 ? '' : undefined}
                    onChange={() => {
                      setQuantities({ [price.id]: 1 });
                      setErrors((e) => ({ ...e, people: undefined }));
                    }}
                    className="mt-0.5 size-5 shrink-0 accent-ocean"
                  />
                  <span className="min-w-0">
                    <span className="jp-wrap block font-semibold text-ink">{price.label}</span>
                    <span className="text-sm text-ink/75">
                      {t('charterPrice', { price: formatYen(price.price), unit })}
                    </span>
                    {price.meetingPoint && (
                      <span className="jp-auto mt-1 block text-xs text-ink/70">
                        {t('meetingPointLabel')}
                        {price.meetingPoint.split('\n')[0]}
                      </span>
                    )}
                  </span>
                  <input type="hidden" name={`qty.${price.id}`} value={checked ? 1 : 0} />
                </label>
              );
            })}
          </div>
        ) : (
          <ul className="clear-both divide-y divide-ocean/10">
            {prices.map((price, index) => {
              const value = quantities[price.id] ?? 0;
              return (
                <li key={price.id} className="flex items-center justify-between gap-4 py-3">
                  <label htmlFor={`qty-${price.id}`} className="min-w-0">
                    <span className="jp-wrap block font-semibold text-ink">
                      <Phrase>{price.label}</Phrase>
                    </span>
                    <span className="text-sm text-ink/75">{t('perUnit', { price: formatYen(price.price), unit })}</span>
                  </label>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setQuantity(price.id, value - 1)}
                      disabled={value === 0}
                      aria-label={t('decrease', { label: price.label })}
                      className="flex size-11 items-center justify-center rounded-full text-ocean ring-1 ring-ocean/20 hover:bg-foam disabled:opacity-30"
                    >
                      <Minus aria-hidden className="size-4" />
                    </button>
                    <input
                      id={`qty-${price.id}`}
                      name={`qty.${price.id}`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={maxPartySize}
                      value={value}
                      data-first-qty={index === 0 ? '' : undefined}
                      onChange={(e) => setQuantity(price.id, Number(e.target.value) || 0)}
                      className="h-11 w-14 rounded-xl border-0 bg-transparent text-center font-heading text-xl font-bold text-ink tabular-nums focus:ring-3 focus:ring-lagoon/25 focus:outline-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <button
                      type="button"
                      onClick={() => setQuantity(price.id, value + 1)}
                      disabled={partySize >= maxPartySize}
                      aria-label={t('increase', { label: price.label })}
                      className="flex size-11 items-center justify-center rounded-full bg-ocean text-white hover:bg-ocean-deep disabled:opacity-30"
                    >
                      <Plus aria-hidden className="size-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {/* 検索の人数が 1 回の予約の上限（または残り枠）を超えて、少なく入れたときは知らせる */}
        {!charter &&
          initialPeople &&
          initialPeople < minPartySize &&
          minPartySize <= maxPartySize &&
          !errors.people && (
            <p className="jp-wrap rounded-xl bg-coral-strong/10 px-3 py-2 text-sm font-semibold text-coral-deep">
              <Phrase>{t('peopleRaised', { min: minPartySize, unit })}</Phrase>
            </p>
          )}
        {!charter && initialPeople && initialPeople > maxPartySize && !errors.people && (
          <p className="jp-wrap rounded-xl bg-coral-strong/10 px-3 py-2 text-sm font-semibold text-coral-deep">
            <Phrase>{t('peopleClamped', { people: initialPeople, max: maxPartySize, unit })}</Phrase>
          </p>
        )}
        {errors.people ? (
          <p id="people-error" className="jp-wrap text-sm font-medium text-red-700">
            <Phrase>{errors.people}</Phrase>
          </p>
        ) : (
          <p className="text-xs text-ink/70">
            {charter
              ? t('charterOptionHint')
              : cappedByRemaining && minPartySize > 1
                ? t('peopleHintRangeRemaining', { min: minPartySize, max: maxPartySize, remaining: maxPartySize, unit })
                : cappedByRemaining
                  ? t('peopleHintRemaining', { max: maxPartySize, unit })
                  : minPartySize > 1
                    ? t('peopleHintRange', { min: minPartySize, max: maxPartySize, unit })
                    : t('peopleHint', { max: maxPartySize, unit })}
          </p>
        )}
        {charter && (
          <Field
            id="guestCount"
            label={t('guestCount')}
            required={t('required')}
            error={errors.guestCount}
            hint={maxGuests ? t('guestCountMax', { max: maxGuests }) : t('guestCountHint')}
          >
            <div className="flex items-center gap-2">
              <input
                id="guestCount"
                name="guestCount"
                type="number"
                inputMode="numeric"
                min={1}
                max={maxGuests ?? 200}
                aria-required
                value={guests}
                aria-invalid={Boolean(errors.guestCount)}
                aria-describedby={describedBy('guestCount', true)}
                onChange={(e) => {
                  setGuests(e.target.value);
                  // 上限を超えたらその場で知らせる（送信まで待たない）
                  const value = Number(e.target.value);
                  if (maxGuests && value > maxGuests) {
                    setErrors((prev) => ({ ...prev, guestCount: t('validationGuestMax', { max: maxGuests }) }));
                  } else {
                    onFix(e);
                  }
                }}
                className={cn(inputClass(Boolean(errors.guestCount)), 'w-28 text-right tabular-nums')}
              />
              <span className="text-sm font-semibold text-ink">{t('guestCountUnit')}</span>
            </div>
          </Field>
        )}
        {/* 追加料金の案内と内訳は、乗船人数の欄（上限の案内・エラー）の下に出す */}
        {charter && includedGuests && extraGuestPrice ? (
          <p className="jp-wrap -mt-2 text-xs text-ink/75">
            <Phrase>
              {t('charterIncluded', {
                included: includedGuests,
                next: includedGuests + 1,
                price: formatYen(extraGuestPrice),
              })}
            </Phrase>
          </p>
        ) : null}
        {/* コースを選ぶまでは合計を出さないので、追加料金の内訳も出さない */}
        {extraGuests > 0 && partySize > 0 && (
          <p className="jp-wrap rounded-xl bg-sand px-3 py-2 text-sm font-semibold text-ocean" aria-live="polite">
            <Phrase>
              {t('charterExtra', {
                count: extraGuests,
                price: formatYen(extraGuestPrice ?? 0),
                amount: formatYen(extraAmount),
                label: priceLabel,
              })}
            </Phrase>
          </p>
        )}
        <div className="flex items-baseline justify-between rounded-2xl bg-foam px-4 py-3">
          <span className="text-sm font-semibold text-ocean">
            {charter && partySize === 0
              ? t('charterChooseFirst', { label: priceLabel })
              : guestsForSummary
                ? t('totalWithGuests', { label: priceLabel, count: partySize, unit, guests: guestsForSummary })
                : t('totalWithPeople', { label: priceLabel, count: partySize, unit })}
          </span>
          <span className="font-heading text-2xl font-black text-ocean tabular-nums" data-testid="total">
            {charter && partySize === 0 ? '—' : formatYen(total)}
          </span>
        </div>
      </fieldset>

      <fieldset className="space-y-4 rounded-3xl bg-white p-5 ring-1 ring-ocean/10 sm:p-6">
        <legend className="float-left mb-1 w-full font-heading text-lg font-bold text-ocean">{t('contact')}</legend>
        <p className="jp-wrap clear-both text-sm text-ink/75">
          <Phrase>{t('contactLead')}</Phrase>
        </p>
        <Field id="name" label={t('name')} required={t('required')} error={errors.name}>
          <input
            id="name"
            name="name"
            autoComplete="name"
            maxLength={100}
            placeholder={t('namePlaceholder')}
            aria-required
            aria-invalid={Boolean(errors.name)}
            aria-describedby={describedBy('name')}
            onChange={onFix}
            className={inputClass(Boolean(errors.name))}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="email" label={t('email')} required={t('required')} error={errors.email}>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              aria-required
              aria-invalid={Boolean(errors.email)}
              aria-describedby={describedBy('email')}
              onChange={onFix}
              className={inputClass(Boolean(errors.email))}
            />
          </Field>
          <Field id="emailConfirm" label={t('emailConfirm')} required={t('required')} error={errors.emailConfirm}>
            <input
              id="emailConfirm"
              name="emailConfirm"
              type="email"
              autoComplete="off"
              inputMode="email"
              aria-required
              aria-invalid={Boolean(errors.emailConfirm)}
              aria-describedby={describedBy('emailConfirm')}
              onChange={onFix}
              onBlur={onConfirmBlur}
              className={inputClass(Boolean(errors.emailConfirm))}
            />
          </Field>
        </div>
        <Field id="phone" label={t('phone')} required={t('required')} error={errors.phone} hint={t('phoneHint')}>
          <input
            id="phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            placeholder={t('phonePlaceholder')}
            aria-required
            aria-invalid={Boolean(errors.phone)}
            aria-describedby={describedBy('phone', true)}
            onChange={onFix}
            className={inputClass(Boolean(errors.phone))}
          />
        </Field>
      </fieldset>

      <fieldset className="space-y-4 rounded-3xl bg-white p-5 ring-1 ring-ocean/10 sm:p-6">
        <legend className="float-left mb-1 w-full font-heading text-lg font-bold text-ocean">{t('request')}</legend>
        <div className="clear-both" />
        {requireAges && (
          <Field
            id="participantAges"
            label={t('participantAges')}
            required={t('required')}
            error={errors.participantAges}
            hint={t('participantAgesHint')}
          >
            <input
              id="participantAges"
              name="participantAges"
              maxLength={200}
              placeholder={t('participantAgesPlaceholder')}
              aria-required
              aria-invalid={Boolean(errors.participantAges)}
              aria-describedby={describedBy('participantAges', true)}
              onChange={onFix}
              className={inputClass(Boolean(errors.participantAges))}
            />
          </Field>
        )}
        <Field id="secondChoice" label={t('secondChoice')} optional={t('optional')} hint={t('secondChoiceHint')}>
          <input
            id="secondChoice"
            name="secondChoice"
            maxLength={200}
            placeholder={t('secondChoicePlaceholder')}
            aria-describedby="secondChoice-hint"
            className={inputClass(false)}
          />
        </Field>
        <Field id="customerNote" label={t('customerNote')} optional={t('optional')}>
          <textarea
            id="customerNote"
            name="customerNote"
            rows={3}
            maxLength={1000}
            placeholder={t('customerNotePlaceholder')}
            className={cn(inputClass(false), 'h-auto min-h-24 py-3 leading-relaxed')}
          />
        </Field>
      </fieldset>

      <div ref={confirmRef} className="scroll-mt-24 space-y-4 rounded-3xl bg-white p-5 ring-1 ring-ocean/10 sm:p-6">
        <h2 className="font-heading text-lg font-bold text-ocean">{t('confirmTitle')}</h2>
        {(
          [
            ['policyTitle', policy],
            ['weatherTitle', weather],
            ['conditionsTitle', conditions],
            ['notesTitle', notes],
          ] as const
        ).map(
          ([title, body]) =>
            body && (
              <div key={title} className="rounded-2xl bg-sand p-4 text-sm">
                <p className="mb-1 font-semibold text-ocean">{t(title)}</p>
                {body}
              </div>
            ),
        )}
        <p className="text-sm">
          <Link
            href="/privacy"
            target="_blank"
            className="jp-auto font-semibold text-lagoon-ink underline underline-offset-4 hover:text-ocean"
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
            id="agree"
            type="checkbox"
            name="agree"
            value="on"
            aria-required
            aria-invalid={Boolean(errors.agree)}
            aria-describedby={errors.agree ? 'agree-error' : undefined}
            onChange={() => setErrors((e) => ({ ...e, agree: undefined }))}
            className="mt-0.5 size-5 shrink-0 accent-ocean"
          />
          <span className="jp-wrap font-medium">{agreeLabel}</span>
        </label>
        {errors.agree && (
          <p id="agree-error" className="jp-wrap -mt-2 text-sm font-medium text-red-700">
            <Phrase>{errors.agree}</Phrase>
          </p>
        )}
        <p className="jp-wrap rounded-2xl bg-foam px-4 py-3 text-sm leading-relaxed text-ocean">
          <Phrase>{t('paymentNote')}</Phrase>
        </p>

        {state.error && !hasErrors && (
          <p role="alert" className="jp-wrap rounded-2xl bg-red-50 p-4 text-sm font-medium text-red-700">
            <Phrase>{t(`errors.${state.error}`, { min: minPartySize })}</Phrase>
          </p>
        )}
        {/* 入力の誤りは、項目名の一覧からその欄へ移動できるようにする（色だけで伝えない） */}
        {hasErrors && (
          <div role="alert" className="rounded-2xl bg-red-50 p-4 text-sm font-medium text-red-700">
            <p>{t('fixErrors', { count: errorFields.length })}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {errorFields.map(([field, label]) => (
                <li key={field}>
                  <a
                    href={`#${field === 'people' ? 'people-error' : field}`}
                    className="jp-wrap underline underline-offset-2"
                    onClick={(event) => {
                      event.preventDefault();
                      const target =
                        field === 'people'
                          ? document.querySelector<HTMLElement>('[data-first-qty]')
                          : document.getElementById(field);
                      target?.scrollIntoView({ block: 'center' });
                      target?.focus();
                    }}
                  >
                    <Phrase>{errors[field] ?? label}</Phrase>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {partySize > 0 && (
          <div className="rounded-2xl bg-sand px-4 py-3 text-sm">
            <p className="flex items-baseline justify-between gap-3">
              <span className="font-semibold text-ocean">{t('totalPlanned')}</span>
              <span className="font-heading text-xl font-black text-ocean tabular-nums">{formatYen(total)}</span>
            </p>
            {/* 申し込む内容（日時・人数）を、送信の直前にもう一度見せる */}
            <p className="mt-1 text-xs text-ink/75 tabular-nums">
              {slotLabel} ・{' '}
              {prices
                .filter((p) => (quantities[p.id] ?? 0) > 0)
                .map((p) => (charter ? p.label : `${p.label} ${quantities[p.id]}${unit}`))
                .join('・')}
              {guestsForSummary ? `・乗船 ${guestsForSummary}名` : ''}
            </p>
          </div>
        )}
        <button
          type="submit"
          disabled={pending || !hydrated}
          className="flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl bg-coral-strong px-6 text-lg font-bold text-white shadow-lg shadow-coral/30 transition hover:bg-coral-deep disabled:opacity-60"
        >
          {pending ? t('submitting') : t('submit')}
        </button>
      </div>

      {/* スマホ：人数を選んだあと、確認欄が見えるまでは画面下に合計を出す（キーボードを開いている間は隠す） */}
      {partySize > 0 && !confirmVisible && !keyboardOpen && (
        <div
          data-mobile-cta
          className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-ocean/10 bg-white/95 px-4 pt-3 backdrop-blur md:hidden"
        >
          <div className="flex items-center justify-between gap-3 pb-3">
            <span className="leading-tight">
              <span className="block text-xs font-semibold text-ocean">
                {guestsForSummary
                  ? t('totalWithGuests', { label: priceLabel, count: partySize, unit, guests: guestsForSummary })
                  : t('totalWithPeople', { label: priceLabel, count: partySize, unit })}
              </span>
              <span className="font-heading text-xl font-black text-ocean tabular-nums">{formatYen(total)}</span>
            </span>
            <button
              type="button"
              onClick={(event) => {
                // まだ入力していない必須の欄があればそこへ、すべて入っていれば確認欄へ移動する
                const form = event.currentTarget.form;
                const empty = ['guestCount', 'name', 'email', 'emailConfirm', 'phone', 'participantAges']
                  .map((id) => form?.querySelector<HTMLInputElement>(`#${id}`))
                  .find((input) => input && !input.value.trim());
                if (empty) empty.focus();
                else confirmRef.current?.scrollIntoView({ block: 'start' });
              }}
              className="min-h-12 rounded-2xl bg-ocean px-5 font-bold text-white hover:bg-ocean-deep"
            >
              {t('next')}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
