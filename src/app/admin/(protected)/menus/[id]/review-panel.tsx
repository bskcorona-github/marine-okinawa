import Link from 'next/link';
import { ConfirmDialog } from '@/components/backoffice/confirm-dialog';
import { PRIMARY_TRIGGER_CLASS } from '@/components/backoffice/field-styles';
import { Notice, Panel } from '@/components/backoffice/page-header';
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

/**
 * 差し戻し（確認の画面で理由を入れて送る。理由は必須で、事業者画面とメールで事業者に伝える）
 */
function RejectForm({ action, what }: { action: (formData: FormData) => Promise<void>; what: string }) {
  return (
    <form action={action}>
      <ConfirmDialog
        triggerLabel="差し戻す…"
        title={`${what}を差し戻しますか？`}
        confirmLabel="差し戻しのメールを送る"
        pendingLabel="送っています…"
      >
        <label className="block space-y-1">
          <span className="block font-medium">差し戻しの理由（必須・事業者に伝えます）</span>
          <Textarea
            name="note"
            rows={3}
            maxLength={1000}
            required
            placeholder="例：メインの写真を、海が写っているものに変えてください"
          />
        </label>
        <p className="text-slate-600">事業者に、理由をメールで知らせます。送ったメールは取り消せません。</p>
      </ConfirmDialog>
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
  schedule,
}: {
  menu: AdminMenu;
  revision: Revision | null;
  operatorName: string | null;
  at: (d: Date) => string;
  activityName: (id: string | null) => string;
  /** 回の設定のまとめ（公開の申請のときに、審査で確かめる項目として出す） */
  schedule: { times: string[]; maxCapacity: number | null } | null;
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
  // 公開の前に確かめてほしいこと（審査の欄と同じものを、承認の確認の画面にも出す）
  const publishWarnings = [
    !(schedule && schedule.times.length > 0) && 'まだ回がありません。公開しても申込を受けられません。',
    !menu.activityId && 'アクティビティが未設定です。アクティビティのページに出ません。',
    menu.images.length === 0 && '写真がありません。',
    menu.prices.some((p) => p.price === 0) && '料金が 0 円の区分があります。',
  ].filter((w): w is string => Boolean(w));
  return (
    <section id="review" className="scroll-mt-6 space-y-4">
      {menu.reviewStatus === 'pending' && (
        <Panel
          title="公開の申請"
          description={`${operatorName ?? '事業者'}から公開の申請がありました${menu.reviewRequestedAt ? `（${at(menu.reviewRequestedAt)}）` : ''}。下の内容と、回の設定（開催時間）を確かめてください。`}
        >
          <dl className="mb-4 grid gap-2 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-[8rem_1fr]">
            <dt className="text-slate-600">アクティビティ</dt>
            <dd className={cn(!menu.activityId && 'font-semibold text-amber-800')}>{activityName(menu.activityId)}</dd>
            <dt className="text-slate-600">料金</dt>
            <dd className="tabular-nums">
              {menu.prices.map((p) => (
                <span key={p.id} className={cn('mr-3 inline-block', p.price === 0 && 'font-semibold text-amber-800')}>
                  {p.label}：{formatYen(p.price)}
                  {p.price === 0 && '（無料）'}
                </span>
              ))}
            </dd>
            <dt className="text-slate-600">回の設定</dt>
            <dd>
              {schedule && schedule.times.length > 0 ? (
                <>
                  {schedule.times.join('・')}（定員 最大 {schedule.maxCapacity}
                  {menu.capacityUnit}）
                </>
              ) : (
                <span className="font-semibold text-amber-800">
                  まだ回がありません（公開しても申込を受けられません）
                </span>
              )}
              <Link
                href={`/admin/menus/${menu.id}/schedule`}
                className="ml-2 inline-flex min-h-9 items-center text-sky-800 underline pointer-coarse:min-h-11"
              >
                回の設定を見る
              </Link>
            </dd>
            <dt className="text-slate-600">写真</dt>
            <dd className={cn(menu.images.length === 0 && 'font-semibold text-amber-800')}>
              {menu.images.length > 0 ? `${menu.images.length} 枚` : 'まだありません'}
            </dd>
          </dl>
          <p className="mb-3 text-sm">
            <a
              href="#sec-basic"
              className="inline-flex min-h-9 items-center font-semibold text-sky-800 underline pointer-coarse:min-h-11"
            >
              説明・写真などの内容を、下のフォームで見る
            </a>
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <form action={approvePublishAction.bind(null, menu.id)}>
              <input type="hidden" name="seenUpdatedAt" value={menu.updatedAt.toISOString()} />
              <ConfirmDialog
                tone="default"
                triggerLabel="承認して公開する…"
                triggerClassName={PRIMARY_TRIGGER_CLASS}
                title="このプランを公開しますか？"
                confirmLabel="プランを公開する"
              >
                <p>お客様のサイトに表示し、申込を受け付けます。事業者には結果をメールで知らせます。</p>
                {publishWarnings.length > 0 && (
                  <div className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
                    <p className="font-semibold">確かめてください</p>
                    <ul className="list-disc space-y-0.5 pl-5">
                      {publishWarnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
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
            <RejectForm action={rejectPublishAction.bind(null, menu.id)} what="公開の申請" />
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
              <>
                {/* スマホでは項目ごとに「今 → 申請」を縦に並べる（表を横にずらさなくてよいように） */}
                <dl className="divide-y divide-slate-100 rounded-lg border border-slate-200 md:hidden">
                  {changes.map((c) => (
                    <div key={c.field} className="space-y-1 p-3">
                      <dt className="font-semibold">{c.label}</dt>
                      <dd className="break-words whitespace-pre-line text-slate-600">
                        <span className="mr-1 inline-block rounded bg-slate-100 px-1.5 text-xs text-slate-700">今</span>
                        {c.before}
                      </dd>
                      <dd className="break-words whitespace-pre-line text-slate-900">
                        <span className="mr-1 inline-block rounded bg-sky-100 px-1.5 text-xs text-sky-900">申請</span>
                        {c.after}
                      </dd>
                    </div>
                  ))}
                </dl>
                <div className="hidden overflow-x-auto md:block">
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
                          <td className="max-w-80 px-3 py-2 break-words whitespace-pre-line text-slate-900">
                            {c.after}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <form action={approveRevisionAction.bind(null, menu.id)}>
                <input type="hidden" name="seenRevisionId" value={revision.id} />
                <input type="hidden" name="seenUpdatedAt" value={revision.updatedAt.toISOString()} />
                <ConfirmDialog
                  tone="default"
                  disabled={conflictLabels.length > 0}
                  triggerLabel="承認して反映する…"
                  triggerClassName={PRIMARY_TRIGGER_CLASS}
                  title="変更を反映しますか？"
                  confirmLabel="変更を反映する"
                >
                  <p>上の差分を公開中のプランに反映します。事業者には結果をメールで知らせます。</p>
                </ConfirmDialog>
              </form>
              <RejectForm action={rejectRevisionAction.bind(null, menu.id)} what="変更の申請" />
            </div>
          </div>
        </Panel>
      )}
    </section>
  );
}
