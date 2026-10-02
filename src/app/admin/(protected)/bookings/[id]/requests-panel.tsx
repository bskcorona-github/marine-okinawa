import Link from 'next/link';
import type { ReactNode } from 'react';
import { ConfirmDialog } from '@/components/backoffice/confirm-dialog';
import { Panel } from '@/components/backoffice/page-header';
import { SubmitButton } from '@/components/backoffice/submit-button';
import { buttonVariants } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { isOpenRequest, type BookingStatus } from '@/modules/booking/status';
import { REQUEST_STATUS_LABELS, type listBookingRequests } from '@/modules/partner/requests';
import { REQUEST_STATUS_TONE } from '@/components/backoffice/request-status-tone';
import { requestOperatorAction, withdrawRequestAction } from './actions';

type Request = Awaited<ReturnType<typeof listBookingRequests>>[number];

/** 予約の詳細の「事業者への受入確認」：照会の一覧・取り下げと、受入確認の依頼 */
export function OperatorRequestsPanel({
  booking: b,
  requests,
  canRequest,
  candidates,
  allOperatorsShown,
  recipients,
  backField,
  at,
}: {
  booking: { id: string; status: BookingStatus; operatorId: string | null };
  requests: Request[];
  /** 受入確認を依頼できる段階か（支払案内の前） */
  canRequest: boolean;
  candidates: { id: string; name: string }[];
  /** プランの実施候補が未設定で、すべての事業者を出している */
  allOperatorsShown: boolean;
  /** 事業者ごとのメールの送り先 */
  recipients: Map<string, string[]>;
  backField: ReactNode;
  at: (d: Date) => string;
}) {
  const requestForm = (
    <form action={requestOperatorAction.bind(null, b.id)} className="space-y-3 text-sm">
      {backField}
      {candidates.length === 0 ? (
        <p className="text-slate-600">
          受入確認を依頼できる事業者がいません。
          <Link href="/admin/operators" className="font-semibold text-sky-800 underline">
            事業者
          </Link>
          を登録してください。
        </p>
      ) : (
        <>
          <fieldset className="space-y-2">
            <legend className="mb-1 font-medium">受入確認を依頼する事業者</legend>
            {allOperatorsShown && (
              <p className="text-xs text-slate-600">
                このプランの実施候補が未設定のため、すべての事業者を出しています（プランの編集で実施候補を設定できます）。
              </p>
            )}
            {candidates.map((o) => {
              const existing = requests.find((r) => r.operatorId === o.id && r.status !== 'withdrawn');
              const to = recipients.get(o.id) ?? [];
              return (
                <label
                  key={o.id}
                  className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 has-checked:border-sky-600 has-checked:bg-sky-50"
                >
                  <input type="checkbox" name="operatorId" value={o.id} className="size-4" />
                  <span className="min-w-0 flex-1">
                    {o.name}
                    {to.length === 0 ? (
                      <span className="block text-xs text-amber-800">
                        メールの送り先なし（事業者画面には出ます。電話でも伝えてください）
                      </span>
                    ) : (
                      <span className="block truncate text-xs text-slate-600">送り先：{to.join('、')}</span>
                    )}
                    {existing && existing.status !== 'pending' && (
                      <span className="block text-xs text-amber-800">
                        選ぶと、前の回答（{REQUEST_STATUS_LABELS[existing.status]}）は回答待ちに戻ります
                      </span>
                    )}
                    {existing?.status === 'pending' && (
                      <span className="block text-xs text-slate-600">選ぶと、依頼のメールをもう一度送ります</span>
                    )}
                  </span>
                  {existing && (
                    <span className="shrink-0 text-xs text-slate-600">
                      依頼済み（{REQUEST_STATUS_LABELS[existing.status]}）
                    </span>
                  )}
                </label>
              );
            })}
          </fieldset>
          <label className="block space-y-1">
            <span className="block font-medium">事業者へのメモ（任意）</span>
            <Textarea name="note" rows={2} maxLength={500} placeholder="例：第2希望の日時でも可能か教えてください" />
          </label>
          <p className="text-xs text-slate-600">
            事業者には、日時・プラン・人数・年齢・ご連絡事項だけを伝えます（お客様の連絡先は予約確定まで伝えません）。
          </p>
          <SubmitButton pendingLabel="依頼中…">受入確認を依頼する</SubmitButton>
        </>
      )}
    </form>
  );

  return (
    <section id="operator-requests" className="scroll-mt-6">
      <Panel
        title="事業者への受入確認"
        description="候補の事業者に、事業者画面とメールで空き・受入の可否を確かめてもらいます。「受入可」の回答があると、組合が実施事業者を選んでいなければ、その事業者を実施事業者にします。"
      >
        {requests.length > 0 && (
          <ul className="divide-y divide-slate-100 text-sm">
            {requests.map((r) => (
              <li key={r.id} className="space-y-1 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">{r.operatorName}</span>
                  <span
                    className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', REQUEST_STATUS_TONE[r.status])}
                  >
                    {REQUEST_STATUS_LABELS[r.status]}
                  </span>
                </div>
                <p className="text-xs text-slate-600 tabular-nums">
                  依頼 {at(r.requestedAt)}
                  {r.respondedAt &&
                    ` ・ 回答 ${at(r.respondedAt)}${r.respondedByName ? `（${r.respondedByName}）` : ''}`}
                </p>
                {r.requestNote && <p className="whitespace-pre-line text-slate-700">依頼のメモ：{r.requestNote}</p>}
                {r.responseNote && (
                  <p className="rounded-lg bg-slate-50 p-2 whitespace-pre-line text-slate-900">
                    事業者のメモ：{r.responseNote}
                  </p>
                )}
                {r.status !== 'withdrawn' &&
                  isOpenRequest(b.status) &&
                  !(b.status === 'awaiting_payment' && r.operatorId === b.operatorId) && (
                    <form action={withdrawRequestAction.bind(null, b.id)}>
                      {backField}
                      <input type="hidden" name="requestId" value={r.id} />
                      <ConfirmDialog
                        tone="default"
                        triggerLabel="取り下げる"
                        triggerClassName="h-8 px-3 text-xs pointer-coarse:min-h-11"
                        title={`「${r.operatorName}」への受入確認を取り下げますか？`}
                        confirmLabel="取り下げる"
                        pendingLabel="保存中…"
                      >
                        <p>
                          事業者画面の受入確認は「受付終了」になり、回答できなくなります。事業者へのメールは送りません。
                          {r.operatorId === b.operatorId
                            ? '実施事業者の割り当ては変わらないため、必要なら「実施事業者」で変えてください。'
                            : ''}
                        </p>
                      </ConfirmDialog>
                    </form>
                  )}
              </li>
            ))}
          </ul>
        )}
        {canRequest &&
          // 照会済みの事業者があれば、照会のフォームは畳んでおく（回答の一覧を先に見せる）
          (requests.length > 0 ? (
            <details className="mt-3 border-t border-slate-100 pt-3">
              <summary
                className={cn(
                  buttonVariants({ variant: 'outline' }),
                  'h-9 cursor-pointer list-none px-3 text-sm [&::-webkit-details-marker]:hidden',
                )}
              >
                ほかの事業者にも受入確認を依頼する・依頼を送り直す
              </summary>
              <div className="mt-3">{requestForm}</div>
            </details>
          ) : (
            requestForm
          ))}
      </Panel>
    </section>
  );
}
