'use client';

import { startTransition, useActionState, useState, type FormEvent } from 'react';
import { SELECT_CLASS } from '@/components/admin/field-styles';
import { StickySaveBar, useUnsavedChanges } from '@/components/admin/form-kit';
import { Panel } from '@/components/admin/page-header';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { AdminFormState } from '@/lib/zod-ja';
import { SeasonPeriodsEditor } from './season-periods-editor';

export type OperatorFormValues = {
  name: string;
  status: string;
  about: string;
  phone: string;
  contactHours: string;
  email: string;
  contactName: string;
  emergencyPhone: string;
  address: string;
  representative: string;
  invoiceNumber: string;
  bankAccount: string;
  periods: { startDate: string; endDate: string }[];
};

type Props = {
  action: (prev: AdminFormState, formData: FormData) => Promise<AdminFormState>;
  initial: OperatorFormValues;
  /** 停止する前に見せる件数（これからの予約・回答待ちの照会）。新規登録では渡さない */
  workload?: { upcoming: number; openRequests: number };
};

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-slate-600">{hint}</p>}
    </div>
  );
}

export function OperatorForm({ action, initial, workload }: Props) {
  const [status, setStatus] = useState(initial.status);
  const suspending = initial.status !== 'suspended' && status === 'suspended';
  const [state, formAction, pending] = useActionState(action, { error: null });
  const { dirty, markDirty } = useUnsavedChanges();

  // form の action 属性を使うと送信後に入力がリセットされるため、onSubmit から呼ぶ（エラー時も入力が残る）
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  return (
    <form method="post" onSubmit={onSubmit} onChange={markDirty} className="space-y-4 text-sm">
      <Panel title="基本情報">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="name" label="事業者名">
            <Input id="name" name="name" defaultValue={initial.name} required />
          </Field>
          <Field
            id="status"
            label="登録状態"
            hint="停止中の事業者は、照会・割り当ての候補に出ません（アカウントも使えなくなります）。"
          >
            <select
              id="status"
              name="status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className={cn(SELECT_CLASS, 'w-full')}
            >
              <option value="active">取引中</option>
              <option value="suspended">停止中</option>
            </select>
            {suspending && workload && (workload.upcoming > 0 || workload.openRequests > 0) && (
              <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950">
                この事業者には、これからの予約（支払待ち・予約確定）が {workload.upcoming} 件、回答待ちの照会が{' '}
                {workload.openRequests}{' '}
                件あります。停止すると事業者画面に入れなくなるため、予約ごとに担当を変えるか、お電話で連絡してください。
              </p>
            )}
          </Field>
          <div className="sm:col-span-2">
            <Field
              id="about"
              label="組合のメモ（事業者の特徴・得意なプランなど）"
              hint="お客様・事業者には表示しません。"
            >
              <Textarea id="about" name="about" rows={3} defaultValue={initial.about} />
            </Field>
          </div>
        </div>
      </Panel>

      <Panel
        title="連絡先"
        description="当日の連絡先は、予約確定後にお客様へ案内します。連絡用メールアドレスには、受入確認の依頼や確定・取消のお知らせを送ります。"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="phone" label="当日の連絡先（電話）">
            <Input
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              defaultValue={initial.phone}
              placeholder="例：098-000-0000"
            />
          </Field>
          <Field id="contactHours" label="電話の受付時間">
            <Input
              id="contactHours"
              name="contactHours"
              defaultValue={initial.contactHours}
              placeholder="例：8:00〜18:00"
            />
          </Field>
          <Field id="email" label="連絡用メールアドレス">
            <Input id="email" name="email" type="email" defaultValue={initial.email} />
          </Field>
          <Field id="contactName" label="担当者">
            <Input id="contactName" name="contactName" defaultValue={initial.contactName} />
          </Field>
          <Field id="emergencyPhone" label="緊急連絡先" hint="組合だけが使います（お客様には案内しません）。">
            <Input
              id="emergencyPhone"
              name="emergencyPhone"
              type="tel"
              inputMode="tel"
              defaultValue={initial.emergencyPhone}
            />
          </Field>
        </div>
      </Panel>

      <Panel title="事業者の登録情報" description="精算・請求に使います。お客様には表示しません。">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="address" label="所在地">
            <Input id="address" name="address" defaultValue={initial.address} />
          </Field>
          <Field id="representative" label="代表者">
            <Input id="representative" name="representative" defaultValue={initial.representative} />
          </Field>
          <Field id="invoiceNumber" label="インボイスの登録番号" hint="T と 13 桁の数字（登録がなければ空欄）">
            <Input
              id="invoiceNumber"
              name="invoiceNumber"
              defaultValue={initial.invoiceNumber}
              placeholder="T1234567890123"
              pattern="T\d{13}"
              className="tabular-nums"
            />
          </Field>
          <div className="sm:col-span-2">
            <Field id="bankAccount" label="精算口座">
              <Textarea id="bankAccount" name="bankAccount" rows={2} defaultValue={initial.bankAccount} />
            </Field>
          </div>
        </div>
      </Panel>

      <Panel>
        {/* 期間が多いとページの大半を占めるため、畳んでおく（閉じていても保存の対象） */}
        <details>
          <summary className="cursor-pointer font-semibold text-slate-900">
            オン期の期間（{initial.periods.length} 期間）
            <span className="ml-2 text-xs font-normal text-slate-600">開いて編集</span>
          </summary>
          <div className="mt-4">
            <SeasonPeriodsEditor initial={initial.periods} onChange={markDirty} />
          </div>
        </details>
      </Panel>

      <StickySaveBar pending={pending} dirty={dirty} error={state.error} issues={state.issues} />
    </form>
  );
}
