'use client';

import { startTransition, useActionState, useState, type FormEvent } from 'react';
import { SELECT_CLASS } from '@/components/backoffice/field-styles';
import { StickySaveBar, useUnsavedChanges } from '@/components/backoffice/form-kit';
import { Panel } from '@/components/backoffice/page-header';
import { RequiredMark } from '@/components/backoffice/required-mark';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { MENU_CATEGORY_LABELS } from '@/modules/booking/labels';
import type { AdminFormState } from '@/lib/zod-ja';

export type ActivityFormValues = {
  slug: string;
  name: string;
  lead: string;
  description: string;
  category: keyof typeof MENU_CATEGORY_LABELS;
  sortOrder: number;
  status: 'published' | 'hidden';
};

export function ActivityForm({
  action,
  initial,
  submitLabel,
}: {
  action: (prev: AdminFormState, formData: FormData) => Promise<AdminFormState>;
  initial: ActivityFormValues;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const { dirty, markDirty } = useUnsavedChanges();
  const [slug, setSlug] = useState(initial.slug);
  const slugError = state.issues?.some((issue) => issue.field === 'slug') ?? false;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  return (
    <form method="post" onSubmit={onSubmit} onChange={markDirty} className="max-w-2xl space-y-4 text-sm">
      <Panel title="基本">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1 sm:col-span-2">
            <span className="block font-medium">
              アクティビティ名
              <RequiredMark />
            </span>
            <Input
              id="name"
              name="name"
              defaultValue={initial.name}
              required
              maxLength={40}
              placeholder="例：パラセーリング"
            />
          </label>
          <label className="block space-y-1">
            <span className="block font-medium">アイコン・色</span>
            <select
              id="category"
              name="category"
              defaultValue={initial.category}
              className={cn(SELECT_CLASS, 'w-full')}
            >
              {Object.entries(MENU_CATEGORY_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-h-11 items-center gap-2 self-end">
            <input
              type="checkbox"
              name="status"
              value="hidden"
              defaultChecked={initial.status === 'hidden'}
              className="size-4"
            />
            サイトに出さない（非公開）
          </label>
          <details className="rounded-lg border border-slate-200 p-3 sm:col-span-2" open={slugError || undefined}>
            <summary className="cursor-pointer py-1.5 font-medium text-slate-700 pointer-coarse:py-3">
              詳しい設定（ふだんは変えなくて大丈夫）
            </summary>
            <div className="mt-2 grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="block font-medium">
                  ページのアドレス（半角英小文字・数字・ハイフン。空欄なら自動）
                </span>
                <Input
                  id="slug"
                  name="slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  placeholder="例：parasailing"
                />
                <span className="block text-xs break-all text-slate-500">
                  お客様向けのページ：/ja/activities/
                  {slug.trim() ||
                    (initial.slug ? `${initial.slug}（空欄にすると今のまま）` : '（保存すると自動で付きます）')}
                </span>
              </label>
              <label className="block space-y-1">
                <span className="block font-medium">並び順（小さいほど先）</span>
                <Input
                  id="sortOrder"
                  name="sortOrder"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={999}
                  defaultValue={initial.sortOrder}
                  className="w-24"
                />
                <span className="block text-xs text-slate-500">一覧の「↑」「↓」でも並べ替えられます。</span>
              </label>
            </div>
          </details>
        </div>
      </Panel>
      <Panel title="紹介文" description="TOP の「アクティビティから探す」とアクティビティページに表示します。">
        <div className="space-y-4">
          <label className="block space-y-1">
            <span className="block font-medium">一覧の紹介文（1〜2 行）</span>
            <Textarea
              id="lead"
              name="lead"
              rows={2}
              maxLength={120}
              defaultValue={initial.lead}
              placeholder="例：ボートに引かれて、沖縄の海の上を空中散歩。"
            />
          </label>
          <label className="block space-y-1">
            <span className="block font-medium">ページの紹介文</span>
            <Textarea
              id="description"
              name="description"
              rows={6}
              maxLength={3000}
              defaultValue={initial.description}
            />
          </label>
        </div>
      </Panel>
      <StickySaveBar
        pending={pending}
        dirty={dirty}
        error={state.error}
        issues={state.issues}
        submitLabel={submitLabel}
      />
    </form>
  );
}
