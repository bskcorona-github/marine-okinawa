'use client';

import { startTransition, useActionState, type FormEvent } from 'react';
import { StickySaveBar, useUnsavedChanges } from '@/components/admin/form-kit';
import { Panel } from '@/components/admin/page-header';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { AdminFormState } from '@/lib/zod-ja';

export function SitePageForm({
  action,
  initial,
}: {
  action: (prev: AdminFormState, formData: FormData) => Promise<AdminFormState>;
  initial: { title: string; body: string };
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const { dirty, markDirty } = useUnsavedChanges();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  return (
    <form method="post" onSubmit={onSubmit} onChange={markDirty} className="max-w-3xl space-y-4 text-sm">
      <Panel>
        <div className="space-y-4">
          <label className="block space-y-1">
            <span className="block font-medium">ページ名</span>
            <Input id="title" name="title" defaultValue={initial.title} required maxLength={60} />
          </label>
          <label className="block space-y-1">
            <span className="block font-medium">本文</span>
            <Textarea
              id="body"
              name="body"
              rows={24}
              defaultValue={initial.body}
              required
              maxLength={20000}
              className="font-mono text-[13px] leading-relaxed"
            />
          </label>
          <div className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
            <p className="font-semibold text-slate-700">書き方</p>
            <p>「## 」で始まる行は見出し、「### 」は小見出し、「- 」または「・」で始まる行は箇条書きになります。</p>
            <p>空行で段落を分けます。HTML のタグは使えません（そのまま文字として表示します）。</p>
          </div>
        </div>
      </Panel>
      <StickySaveBar pending={pending} dirty={dirty} error={state.error} issues={state.issues} />
    </form>
  );
}
