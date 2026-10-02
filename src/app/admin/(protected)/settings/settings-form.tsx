'use client';

import { startTransition, useActionState, useState, type FormEvent, type ReactNode } from 'react';
import { SELECT_CLASS } from '@/components/backoffice/field-styles';
import { StickySaveBar, useUnsavedChanges } from '@/components/backoffice/form-kit';
import { Panel } from '@/components/backoffice/page-header';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { AdminFormState } from '@/lib/zod-ja';
import type { ShopSettings } from '@/modules/shop/settings';

export type SettingsFormValues = {
  name: string;
  phone: string;
  email: string;
  businessHours: string;
  introduction: string;
  address: string;
  landmark: string;
  parking: string;
  directions: string[];
  nearbyHotels: string[];
  lowStockThresholdPercent: number;
  lowStockThresholdCount: number;
  timezone: string;
  settings: ShopSettings;
};

type Props = {
  action: (prev: AdminFormState, formData: FormData) => Promise<AdminFormState>;
  initial: SettingsFormValues;
};

function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={className ?? 'block space-y-1'}>
      <span className="block font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function SettingsForm({ action, initial }: Props) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const { dirty, markDirty } = useUnsavedChanges();
  const [paused, setPaused] = useState(initial.settings.bookingPaused);
  const s = initial.settings;

  // form の action 属性を使うと送信後に入力がリセットされるため、onSubmit から呼ぶ（エラー時も入力が残る）
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  return (
    <form method="post" onSubmit={onSubmit} onChange={markDirty} className="space-y-4 text-sm">
      <Panel
        title="Web 申込の受付"
        description="止めている間も、サイトのページは見られます。申込フォームの代わりに案内文を表示します。"
      >
        <label
          className={
            paused
              ? 'flex min-h-11 items-center gap-3 rounded-lg border-2 border-red-400 bg-red-50 px-3 font-semibold text-red-900'
              : 'flex min-h-11 items-center gap-3 rounded-lg border border-slate-300 px-3 font-semibold'
          }
        >
          <input
            type="checkbox"
            name="bookingPaused"
            defaultChecked={s.bookingPaused}
            onChange={(e) => setPaused(e.currentTarget.checked)}
            className="size-5"
          />
          {paused ? 'Web 申込を停止中（チェックを外して保存すると再開します）' : 'Web 申込を一時停止する'}
        </label>
        <Field label="受付停止中の案内文" className="mt-3 block space-y-1">
          <Textarea
            id="bookingPausedMessage"
            name="bookingPausedMessage"
            rows={2}
            defaultValue={s.bookingPausedMessage}
          />
        </Field>
      </Panel>

      <Panel title="予約・お支払い" description="税務・決済の方式が決まったら、ここで文言と日数を変えられます。">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="料金の見出し" hint="プランの料金・予約フォームの合計・メールに使います（例：お支払総額）。">
            <Input id="priceLabel" name="priceLabel" defaultValue={s.priceLabel} required maxLength={20} />
          </Field>
          <Field label="支払期限（日数）" hint="支払案内を送った日から数えます。参加日の前日を超えることはありません。">
            <span className="flex items-center gap-2">
              <Input
                id="paymentDueDays"
                name="paymentDueDays"
                type="number"
                inputMode="numeric"
                min={1}
                max={30}
                defaultValue={s.paymentDueDays}
                className="w-20"
              />
              日後まで
            </span>
          </Field>
          <Field
            label="支払方法の案内"
            className="block space-y-1 sm:col-span-2"
            hint="支払案内メールと予約確認ページに表示します（振込先・決済ページの URL・注意事項など）。"
          >
            <Textarea
              id="paymentInstructions"
              name="paymentInstructions"
              rows={5}
              defaultValue={s.paymentInstructions}
              placeholder={
                '例：\n下記の口座へお振り込みください。\n○○銀行 ○○支店 普通 1234567\nオキナワケン マリンレジャー ジギョウ キョウドウクミアイ'
              }
            />
          </Field>
          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              name="autoRequestOwner"
              defaultChecked={s.autoRequestOwner}
              className="mt-0.5 size-4"
            />
            <span>
              <span className="block font-medium">申込を受けたら、プランの事業者へ自動で受入確認を送る</span>
              <span className="block text-xs text-slate-600">
                事業者が登録したプランへの申込は、その事業者へすぐに受入確認（空き・受入の可否の確認）を依頼します。外すと、組合が予約の画面から依頼します。
              </span>
            </span>
          </label>
          <Field
            label="ご連絡の目安"
            className="block space-y-1 sm:col-span-2"
            hint="申込を受け付けたお客様に、組合から連絡するまでの目安として、受付完了ページと受付メールに表示します。空欄なら表示しません。"
          >
            <Input
              id="replyGuide"
              name="replyGuide"
              defaultValue={s.replyGuide}
              maxLength={200}
              placeholder="例：受付から 2 営業日以内に、メールでご連絡します"
            />
          </Field>
          <Field
            label="共通のキャンセル規定"
            className="block space-y-1 sm:col-span-2"
            hint="すべてのプランに表示します。プランごとの規定は、各プランの編集画面で追加します。"
          >
            <Textarea
              id="commonCancellationPolicy"
              name="commonCancellationPolicy"
              rows={5}
              defaultValue={s.commonCancellationPolicy}
            />
          </Field>
          <Field
            label="天候・海況による中止の扱い（共通）"
            className="block space-y-1 sm:col-span-2"
            hint="すべてのプランの詳細・申込フォーム・予約確認ページに表示します。中止を決める時刻、お客様への連絡のしかた、返金の扱いを書いてください。プランごとの扱いは、各プランの編集画面で追加します。"
          >
            <Textarea
              id="commonWeatherPolicy"
              name="commonWeatherPolicy"
              rows={4}
              defaultValue={s.commonWeatherPolicy}
              placeholder={
                '例：\n天候・海況により中止する場合は、前日 18 時までに組合からメールまたはお電話でご連絡します。\nお支払い済みの料金は全額返金します。'
              }
            />
          </Field>
        </div>
      </Panel>

      <Panel
        title="手数料・取消・精算"
        description="月次精算と、取消・天候中止のときの返金予定額の初期値に使います。正式な値が決まったら、ここで変えてください。"
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="組合の手数料率（%）" hint="事業者の受け取り分から差し引きます（税込）。">
            <Input
              id="commissionRate"
              name="commissionRate"
              type="number"
              inputMode="decimal"
              min={0}
              max={50}
              step={0.1}
              defaultValue={s.commissionRate}
              className="w-28"
            />
          </Field>
          <Field label="天候中止の返金率（%）" hint="100 なら全額返金。一括の天候中止にも使います。">
            <Input
              id="weatherRefundPercent"
              name="weatherRefundPercent"
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              defaultValue={s.weatherRefundPercent}
              className="w-28"
            />
          </Field>
          <Field label="事業者への支払日" hint="月末で締めて、翌月のこの日に払います。">
            <select id="payoutDay" name="payoutDay" defaultValue={s.payoutDay} className={cn(SELECT_CLASS, 'w-40')}>
              <option value={0}>翌月末</option>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  翌月 {d} 日
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="精算を始める月（任意）"
            hint="この月より前に参加した予約は、月次精算に入れません（それまでの分を別に精算していたとき）。空欄ならすべて入れます。"
          >
            <Input
              id="settlementStartMonth"
              name="settlementStartMonth"
              type="month"
              defaultValue={s.settlementStartMonth}
              className="w-44"
            />
          </Field>
        </div>
        <fieldset className="mt-4 space-y-2">
          <legend className="font-medium">お客様の都合の取消のキャンセル料</legend>
          <div className="flex flex-wrap items-end gap-4 text-sm">
            <label className="space-y-1">
              <span className="block text-xs text-slate-600">無料になる日数</span>
              <span className="flex items-center gap-1">
                参加日の
                <Input
                  id="cancelFreeDays"
                  name="cancelFreeDays"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={60}
                  defaultValue={s.cancelFreeDays}
                  className="w-20"
                />
                日前まで無料
              </span>
            </label>
            <label className="space-y-1">
              <span className="block text-xs text-slate-600">それを過ぎて前日まで</span>
              <span className="flex items-center gap-1">
                <Input
                  id="cancelMidPercent"
                  name="cancelMidPercent"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={100}
                  defaultValue={s.cancelMidPercent}
                  className="w-20"
                />
                %
              </span>
            </label>
            <label className="space-y-1">
              <span className="block text-xs text-slate-600">当日・無断キャンセル</span>
              <span className="flex items-center gap-1">
                <Input
                  id="cancelSameDayPercent"
                  name="cancelSameDayPercent"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={100}
                  defaultValue={s.cancelSameDayPercent}
                  className="w-20"
                />
                %
              </span>
            </label>
          </div>
          <p className="text-xs text-slate-500">
            この率から作ったキャンセル料の規定を、プラン詳細・申込フォーム・予約確認ページに出します（取消のときの返金予定額の初期値にも使い、予約ごとに直せます）。率は申込のときの値で予約に残すので、変えても申込済みの予約には効きません。
          </p>
        </fieldset>
        <label className="mt-4 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="cancellationFeeToOperator"
            defaultChecked={s.cancellationFeeToOperator}
            className="mt-0.5 size-4"
          />
          <span>
            <span className="block font-medium">キャンセル料（返金しない額）を事業者の取り分にする</span>
            <span className="block text-xs text-slate-600">
              手数料率を引いて、月次精算で事業者に払います。外すと組合が受け取ります。
            </span>
          </span>
        </label>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="組合のインボイスの登録番号" hint="精算明細の手数料に載せます（T と 13 桁の数字）。">
            <Input
              id="invoiceNumber"
              name="invoiceNumber"
              defaultValue={s.invoiceNumber}
              maxLength={20}
              placeholder="T1234567890123"
              className="w-56"
            />
          </Field>
          <Field
            label="領収書の型"
            hint="お客様への領収書の書き方です。どちらにするかは、組合の税理士に確認してから決めてください。"
          >
            <span id="receiptModel" className="block space-y-2">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="receiptModel"
                  value="agent"
                  defaultChecked={s.receiptModel === 'agent'}
                  className="mt-0.5 size-4"
                />
                <span>
                  <span className="block font-medium">事業者の代理として組合が受け取る</span>
                  <span className="block text-xs text-slate-600">領収書に実施事業者の名前と登録番号を載せます。</span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="receiptModel"
                  value="seller"
                  defaultChecked={s.receiptModel === 'seller'}
                  className="mt-0.5 size-4"
                />
                <span>
                  <span className="block font-medium">組合が売り手になる</span>
                  <span className="block text-xs text-slate-600">領収書は組合の名前と登録番号です。</span>
                </span>
              </label>
            </span>
          </Field>
        </div>
      </Panel>

      <Panel title="サイトと運営者" description="ヘッダー・フッター・運営者情報・メールに表示されます。">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="サイト名" className="block space-y-1 sm:col-span-2">
            <Input id="siteName" name="siteName" defaultValue={s.siteName} required maxLength={60} />
          </Field>
          <Field label="運営者名（組合名）" className="block space-y-1 sm:col-span-2">
            <Input id="name" name="name" defaultValue={initial.name} required />
          </Field>
          <Field label="紹介文（トップページ）" className="block space-y-1 sm:col-span-2">
            <Textarea id="introduction" name="introduction" rows={4} defaultValue={initial.introduction} />
          </Field>
          <Field label="所在地">
            <Input id="address" name="address" defaultValue={initial.address} />
          </Field>
          <Field label="目印">
            <Input id="landmark" name="landmark" defaultValue={initial.landmark} />
          </Field>
          <Field label="駐車場" className="block space-y-1 sm:col-span-2">
            <Input id="parking" name="parking" defaultValue={initial.parking} />
          </Field>
          <Field label="行き方（1 行に 1 つ）">
            <Textarea id="directions" name="directions" rows={3} defaultValue={initial.directions.join('\n')} />
          </Field>
          <Field label="近くのホテル（1 行に 1 つ）">
            <Textarea id="nearbyHotels" name="nearbyHotels" rows={3} defaultValue={initial.nearbyHotels.join('\n')} />
          </Field>
        </div>
      </Panel>

      <Panel title="お問い合わせ先" description="サイトのフッター・予約確認ページ・メールに表示されます。">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="電話番号">
            <Input
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              defaultValue={initial.phone}
              placeholder="例：098-000-0000"
            />
          </Field>
          <Field label="受付時間">
            <Input
              id="businessHours"
              name="businessHours"
              defaultValue={initial.businessHours}
              placeholder="例：8:00〜18:00"
            />
          </Field>
          <Field
            label="お問い合わせ用のメールアドレス"
            className="block space-y-1 sm:col-span-2"
            hint="メールの返信先になります。お客様がメールに返信すると、このアドレスに届きます。"
          >
            <Input
              id="email"
              name="email"
              type="email"
              defaultValue={initial.email}
              placeholder="例：info@example.com"
            />
          </Field>
          <Field
            label="新規申込・お問い合わせの通知先"
            className="block space-y-1 sm:col-span-2"
            hint="空欄なら、お問い合わせ用のメールアドレスに通知します。"
          >
            <Input id="adminNotifyEmail" name="adminNotifyEmail" type="email" defaultValue={s.adminNotifyEmail} />
          </Field>
        </div>
      </Panel>

      <Panel
        title="「残りわずか（△）」の表示基準"
        description="どちらかを満たすと、お客様向けのカレンダーで △ になります（定員が基準の人数以下のプランは ○ と × だけで表示します）。"
      >
        <div className="flex flex-wrap items-center gap-2">
          残り枠が定員の
          <Input
            id="lowStockThresholdPercent"
            name="lowStockThresholdPercent"
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            defaultValue={initial.lowStockThresholdPercent}
            aria-label="残り枠の割合（%）"
            className="w-20"
          />
          % 以下、または
          <Input
            id="lowStockThresholdCount"
            name="lowStockThresholdCount"
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            defaultValue={initial.lowStockThresholdCount}
            aria-label="残り枠の人数"
            className="w-20"
          />
          名以下
        </div>
      </Panel>
      <p className="text-xs text-slate-500">タイムゾーン：{initial.timezone}（変更できません）</p>

      <StickySaveBar pending={pending} dirty={dirty} error={state.error} issues={state.issues} />
    </form>
  );
}
