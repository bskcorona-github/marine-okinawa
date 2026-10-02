import { ConfirmDialog } from '@/components/backoffice/confirm-dialog';
import { Notice, Panel } from '@/components/backoffice/page-header';
import { SubmitButton } from '@/components/backoffice/submit-button';
import { Textarea } from '@/components/ui/textarea';
import type { menuRevisions } from '@/db/schema';
import { formatYen } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { MenuInput } from '@/modules/catalog/menu-admin';
import type { AdminMenu } from '@/modules/catalog/menus';
import { MENU_FIELD_LABELS } from '@/modules/catalog/menu-form-data';
import { diffPlanInput, menuToInput, mergePlanRevision } from '@/modules/catalog/operator-plans';
import {
  approvePublishAction,
  approveRevisionAction,
  rejectPublishAction,
  rejectRevisionAction,
} from './review-actions';

type Revision = typeof menuRevisions.$inferSelect;

/** 差し戻しの理由の欄と送信ボタン（理由は必須。事業者画面とメールで事業者に伝える） */
function RejectForm({ action }: { action: (formData: FormData) => Promise<void> }) {
  return (
    <form action={action} className="space-y-2">
      <label className="block space-y-1 text-sm">
        <span className="block font-medium">差し戻しの理由（必須・事業者に伝えます）</span>
        <Textarea
          name="note"
          rows={2}
          maxLength={1000}
          required
          placeholder="例：メインの写真を、海が写っているものに変えてください"
        />
      </label>
      <SubmitButton variant="outline" pendingLabel="保存中…">
        差し戻す
      </SubmitButton>
    </form>
  );
}

/**
 * 事業者からの申請（公開・内容の変更）の審査。公開の申請は今の内容（下のフォーム）を見て承認する。
 * 変更の申請は、今の内容との差分を見て承認する（承認すると申請の内容で上書きする）
 */
export function ReviewPanel({
  menu,
  revision,
  operatorName,
  at,
  activityName,
}: {
  menu: AdminMenu;
  revision: Revision | null;
  operatorName: string | null;
  at: (d: Date) => string;
  activityName: (id: string | null) => string;
}) {
  if (menu.reviewStatus !== 'pending' && !revision) return null;
  const current = menuToInput(menu);
  // 承認したときに反映される内容：申請のもとにした内容から事業者が変えた項目だけを、今の内容に重ねる
  const merged = revision
    ? revision.baseData
      ? mergePlanRevision(revision.baseData as MenuInput, current, revision.data as MenuInput)
      : { input: revision.data as MenuInput, conflicts: [] }
    : null;
  const changes = merged ? diffPlanInput(current, merged.input, activityName) : [];
  const conflictLabels = (merged?.conflicts ?? []).map((field) => MENU_FIELD_LABELS[field] ?? field);
  return (
    <section id="review" className="scroll-mt-6 space-y-4">
      {menu.reviewStatus === 'pending' && (
        <Panel
          title="公開の申請"
          description={`${operatorName ?? '事業者'}から公開の申請がありました${menu.reviewRequestedAt ? `（${at(menu.reviewRequestedAt)}）` : ''}。下の内容と、回の設定（開催時間）を確かめてください。`}
        >
          <div className="flex flex-wrap items-start gap-6">
            <form action={approvePublishAction.bind(null, menu.id)}>
              <input type="hidden" name="seenUpdatedAt" value={menu.updatedAt.toISOString()} />
              <ConfirmDialog
                tone="default"
                triggerLabel="承認して公開する"
                title="このプランを公開しますか？"
                confirmLabel="公開する"
              >
                <p>お客様のサイトに表示し、申込を受け付けます。事業者には結果をメールで知らせます。</p>
                <div className="rounded-lg border border-slate-200 p-3">
                  <p className="mb-1 font-medium">料金（このまま公開します）</p>
                  <ul className="space-y-0.5 tabular-nums">
                    {menu.prices.map((p) => (
                      <li key={p.id} className={cn(p.price === 0 && 'font-semibold text-amber-800')}>
                        {p.label}：{formatYen(p.price)}
                        {p.price === 0 && '（無料）'}
                      </li>
                    ))}
                  </ul>
                </div>
              </ConfirmDialog>
            </form>
            <div className="min-w-64 flex-1">
              <RejectForm action={rejectPublishAction.bind(null, menu.id)} />
            </div>
          </div>
        </Panel>
      )}
      {revision && (
        <Panel
          title="内容の変更の申請"
          description={`${operatorName ?? '事業者'}から、公開中のプランの変更の申請がありました（${at(revision.updatedAt)}）。承認すると、事業者が変えた項目を公開中の内容に反映します。`}
        >
          <div className="space-y-4 text-sm">
            {revision.note && (
              <p className="rounded-lg bg-sky-50 p-3 whitespace-pre-line text-sky-950">
                事業者からのひとこと：{revision.note}
              </p>
            )}
            {conflictLabels.length > 0 ? (
              <Notice tone="error">
                申請のあとに組合が同じ項目（{conflictLabels.join('・')}
                ）を直したため、このままでは承認できません。差し戻して、事業者にもう一度申請してもらってください。
              </Notice>
            ) : (
              revision.baseData &&
              menu.updatedAt > revision.createdAt && (
                <Notice tone="info">
                  申請のあとに組合が直した項目は、そのまま残します（下の差分は、承認すると変わるところです）。
                </Notice>
              )
            )}
            {changes.length === 0 ? (
              <p className="text-slate-600">今の内容と違うところはありません。</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[36rem] text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-700">
                    <tr>
                      <th scope="col" className="w-36 px-3 py-2 text-left">
                        項目
                      </th>
                      <th scope="col" className="px-3 py-2 text-left">
                        今の内容
                      </th>
                      <th scope="col" className="px-3 py-2 text-left">
                        申請の内容
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 align-top">
                    {changes.map((c) => (
                      <tr key={c.field}>
                        <th scope="row" className="px-3 py-2 text-left font-medium">
                          {c.label}
                        </th>
                        <td className="max-w-80 px-3 py-2 break-words whitespace-pre-line text-slate-600">
                          {c.before}
                        </td>
                        <td className="max-w-80 px-3 py-2 break-words whitespace-pre-line text-slate-900">{c.after}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex flex-wrap items-start gap-6">
              <form action={approveRevisionAction.bind(null, menu.id)}>
                <input type="hidden" name="seenRevisionId" value={revision.id} />
                <input type="hidden" name="seenUpdatedAt" value={revision.updatedAt.toISOString()} />
                <ConfirmDialog
                  tone="default"
                  disabled={conflictLabels.length > 0}
                  triggerLabel="承認して反映する"
                  title="変更を反映しますか？"
                  confirmLabel="反映する"
                >
                  <p>上の差分を公開中のプランに反映します。事業者には結果をメールで知らせます。</p>
                </ConfirmDialog>
              </form>
              <div className="min-w-64 flex-1">
                <RejectForm action={rejectRevisionAction.bind(null, menu.id)} />
              </div>
            </div>
          </div>
        </Panel>
      )}
    </section>
  );
}
