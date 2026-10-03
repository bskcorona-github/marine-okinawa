'use client';

import { Loader2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Phrase } from '@/components/site/phrase';

type Labels = {
  title: string;
  lead: string;
  open: string;
  confirmTitle: string;
  irreversible: string;
  submit: string;
  submitting: string;
  back: string;
};

/**
 * 予約確認ページの「この予約を取り消す」。押すと見積もり（キャンセル料・返金額）を出し、もう一度押したら取り消す。
 * 見積もりの返金額・料率をフォームで送り、サーバーで計算し直した額と違えば取り消さない
 */
export function CancelPanel({
  action,
  labels,
  lines,
  expected,
}: {
  action: (formData: FormData) => Promise<void>;
  labels: Labels;
  /** 見積もりの説明（参加日の何日前・キャンセル料・返金額・返金の方法） */
  lines: string[];
  expected: { refundAmount: number; feePercent: number };
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <section className="rounded-3xl bg-white p-6 ring-1 ring-ocean/10" aria-labelledby="cancel-title">
      <h2 id="cancel-title" className="mb-1 font-heading text-lg font-bold text-ocean">
        {labels.title}
      </h2>
      {!confirming ? (
        <>
          <p className="jp-wrap mb-3 text-sm text-ink/75">
            <Phrase>{labels.lead}</Phrase>
          </p>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-bold text-coral-deep ring-1 ring-coral-deep/40 hover:bg-coral-strong/10"
          >
            <XCircle aria-hidden className="size-4" />
            {labels.open}
          </button>
        </>
      ) : (
        <form action={action} className="space-y-3 rounded-2xl bg-coral-strong/10 p-4">
          <p className="font-bold text-coral-deep" role="status">
            {labels.confirmTitle}
          </p>
          <ul className="jp-wrap space-y-1 text-sm leading-relaxed text-ink">
            {lines.map((line) => (
              <li key={line}>
                <Phrase>{line}</Phrase>
              </li>
            ))}
          </ul>
          <p className="text-sm font-semibold text-coral-deep">{labels.irreversible}</p>
          <input type="hidden" name="refundAmount" value={expected.refundAmount} />
          <input type="hidden" name="feePercent" value={expected.feePercent} />
          <div className="flex flex-wrap gap-3">
            <SubmitButton label={labels.submit} pendingLabel={labels.submitting} />
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold text-ink/80 ring-1 ring-ink/20 hover:bg-white"
            >
              {labels.back}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

/** 送信中は押せなくする（二重に送らないように。サーバーでも 2 回目は取り消し済みとして扱う） */
function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-coral-deep px-5 text-sm font-bold text-white hover:bg-coral-strong disabled:cursor-wait disabled:opacity-80"
    >
      {pending && <Loader2 aria-hidden className="size-4 animate-spin" />}
      <span role={pending ? 'status' : undefined}>{pending ? pendingLabel : label}</span>
    </button>
  );
}
