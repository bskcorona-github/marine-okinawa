'use client';

import { startTransition, useActionState, useRef, useState, type FormEvent } from 'react';
import { StickySaveBar, useUnsavedChanges } from '@/components/backoffice/form-kit';
import { Panel } from '@/components/backoffice/page-header';
import { SimpleText } from '@/components/site/simple-text';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { AdminFormState } from '@/lib/zod-ja';

/** 本文に入れる書き方の見本（押すと、カーソルの位置に入る） */
const SNIPPETS = [
  { label: '見出しを入れる', text: '## 見出し' },
  { label: '小見出しを入れる', text: '### 小見出し' },
  { label: '箇条書きを入れる', text: '- 項目' },
] as const;

export function SitePageForm({
  action,
  initial,
}: {
  action: (prev: AdminFormState, formData: FormData) => Promise<AdminFormState>;
  initial: { title: string; body: string };
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const { dirty, markDirty } = useUnsavedChanges();
  const [body, setBody] = useState(initial.body);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  /** カーソルのある行の下に、書き方の見本を 1 行入れる */
  function insert(text: string) {
    const el = bodyRef.current;
    if (!el) return;
    const at = el.selectionEnd ?? body.length;
    const lineEnd = body.indexOf('\n', at);
    const pos = lineEnd === -1 ? body.length : lineEnd;
    const before = body.slice(0, pos);
    const next = `${before}${before && !before.endsWith('\n') ? '\n' : ''}${text}\n${body.slice(pos).replace(/^\n/, '')}`;
    setBody(next);
    markDirty();
    // 入れた見本の文字を選んだ状態にして、そのまま打ち直せるようにする
    const start = next.indexOf(text, before.length);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + text.lastIndexOf(' ') + 1, start + text.length);
    });
  }

  return (
    <form method="post" onSubmit={onSubmit} onChange={markDirty} className="max-w-6xl space-y-4 text-sm">
      <Panel>
        <div className="space-y-4">
          <label className="block max-w-3xl space-y-1">
            <span className="block font-medium">ページ名</span>
            <Input id="title" name="title" defaultValue={initial.title} required maxLength={60} />
          </label>
          <div className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
            <p className="font-semibold text-slate-700">書き方</p>
            <p>
              「## 」で始まる行は見出し、「### 」は小見出し、「-
              」または「・」で始まる行は箇条書きになります。空行で段落を分けます。HTML
              のタグは使えません（そのまま文字として表示します）。
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {SNIPPETS.map((s) => (
                <Button key={s.label} type="button" variant="outline" size="sm" onClick={() => insert(s.text)}>
                  {s.label}
                </Button>
              ))}
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <label className="block space-y-1">
              <span className="block font-medium">本文</span>
              <Textarea
                ref={bodyRef}
                id="body"
                name="body"
                rows={24}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                required
                maxLength={20000}
                className="text-sm leading-relaxed"
              />
            </label>
            {/* サイトでの見た目（入力に合わせて変わる）。スマホでは開いて見る */}
            <details className="space-y-1" open>
              <summary className="cursor-pointer py-1.5 font-medium pointer-coarse:py-3 lg:pointer-events-none lg:list-none">
                サイトでの見た目（プレビュー）
              </summary>
              <div className="max-h-[36rem] overflow-y-auto rounded-xl bg-white p-5 ring-1 ring-slate-200">
                {body.trim() ? (
                  <SimpleText text={body} />
                ) : (
                  <p className="text-slate-500">本文を書くと、ここにサイトでの見た目が出ます。</p>
                )}
              </div>
            </details>
          </div>
        </div>
      </Panel>
      <StickySaveBar pending={pending} dirty={dirty} error={state.error} issues={state.issues} />
    </form>
  );
}
