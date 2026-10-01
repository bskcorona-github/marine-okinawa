import { ConfirmDialog } from '@/components/admin/confirm-dialog';
import { Notice, Panel } from '@/components/admin/page-header';
import { SubmitButton } from '@/components/admin/submit-button';
import { Textarea } from '@/components/ui/textarea';
import type { menuRevisions } from '@/db/schema';
import type { MenuInput } from '@/modules/catalog/menu-admin';
import type { AdminMenu } from '@/modules/catalog/menus';
import { diffPlanInput, menuToInput } from '@/modules/catalog/operator-plans';
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
  const changes = revision ? diffPlanInput(menuToInput(menu), revision.data as MenuInput, activityName) : [];
  return (
    <section id="review" className="scroll-mt-6 space-y-4">
      {menu.reviewStatus === 'pending' && (
        <Panel
          title="公開の申請"
          description={`${operatorName ?? '事業者'}から公開の申請がありました${menu.reviewRequestedAt ? `（${at(menu.reviewRequestedAt)}）` : ''}。下の内容と、回の設定（開催時間）を確かめてください。`}
        >
          <div className="flex flex-wrap items-start gap-6">
            <form action={approvePublishAction.bind(null, menu.id)}>
              <ConfirmDialog
                tone="default"
                triggerLabel="承認して公開する"
                title="このプランを公開しますか？"
                confirmLabel="公開する"
              >
                <p>お客様のサイトに表示し、申込を受け付けます。事業者には結果をメールで知らせます。</p>
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
          description={`${operatorName ?? '事業者'}から、公開中のプランの変更の申請がありました（${at(revision.updatedAt)}）。承認すると、公開中の内容を申請の内容に変えます。`}
        >
          <div className="space-y-4 text-sm">
            {revision.note && (
              <p className="rounded-lg bg-sky-50 p-3 whitespace-pre-line text-sky-950">
                事業者からのひとこと：{revision.note}
              </p>
            )}
            {menu.updatedAt > revision.updatedAt && (
              <Notice tone="warning">
                申請のあとに、組合がこのプランを直しています。承認すると、申請の内容で上書きします（下の差分は今の内容との違いです）。
              </Notice>
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
                <ConfirmDialog
                  tone="default"
                  triggerLabel="承認して反映する"
                  title="変更を反映しますか？"
                  confirmLabel="反映する"
                >
                  <p>公開中のプランを申請の内容に変えます。事業者には結果をメールで知らせます。</p>
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
