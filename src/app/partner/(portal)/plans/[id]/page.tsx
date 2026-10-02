import Link from 'next/link';
import { notFound } from 'next/navigation';
import { toFormValues } from '@/components/backoffice/menu-form-values';
import { MenuForm } from '@/components/backoffice/menu-form';
import { ConfirmDialog } from '@/components/backoffice/confirm-dialog';
import { Notice, PageHeader, Panel } from '@/components/backoffice/page-header';
import { SubmitButton } from '@/components/backoffice/submit-button';
import { buttonVariants } from '@/components/ui/button';
import { db } from '@/db';
import { formatDateLabel, localTime } from '@/lib/dates';
import { ownValue } from '@/lib/own';
import { cn } from '@/lib/utils';
import { isUuid } from '@/lib/validation';
import { requireOperator } from '@/modules/auth/guard';
import { menuHasBookings } from '@/modules/booking/queries';
import { listActivitiesForAdmin } from '@/modules/catalog/activities';
import { splitPlanTitle } from '@/modules/catalog/display-title';
import type { MenuInput } from '@/modules/catalog/menu-admin';
import { PLAN_ERROR_LABELS, getOperatorPlan, menuToInput } from '@/modules/catalog/operator-plans';
import { getShopById } from '@/modules/shop/shops';
import {
  pausePlanAction,
  requestPublishAction,
  resumePlanAction,
  savePlanAction,
  uploadPlanImageAction,
  withdrawPublishAction,
  withdrawRevisionAction,
} from '../actions';
import { PLAN_STATE_LABELS, PLAN_STATE_TONE, planState } from '@/components/backoffice/plan-state';

export const metadata = { title: 'プランの編集' };

const DONE: Record<string, string> = {
  publish_requested: '公開を申請しました。組合が内容を確かめてから公開します（結果はメールでもお知らせします）。',
  publish_withdrawn: '公開の申請を取り下げました。下書きに戻っています。',
  revision_withdrawn: '変更の申請を取り下げました。今の内容のまま公開しています。',
  paused: '受付を一時停止しました。ページは見られますが、新しい申込は受け付けません。',
  resumed: '受付を再開しました。',
};

export default async function PartnerPlanPage({ params, searchParams }: PageProps<'/partner/plans/[id]'>) {
  const operator = await requireOperator();
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  const [shop, plan, activities, hasBookings] = await Promise.all([
    getShopById(db, operator.shopId),
    getOperatorPlan(db, { shopId: operator.shopId, operatorId: operator.operatorId, menuId: id }),
    listActivitiesForAdmin(db, operator.shopId),
    menuHasBookings(db, id),
  ]);
  if (!plan) notFound();
  const { menu, pendingRevision, rejectedRevision, hasSchedule } = plan;
  const state = planState(menu);
  const live = state === 'published' || state === 'paused';
  const at = (d: Date) => `${formatDateLabel(d, shop.timezone)} ${localTime(d, shop.timezone)}`;
  const done = ownValue(DONE, sp.done);
  const error = typeof sp.error === 'string' ? ownValue<string>(PLAN_ERROR_LABELS, sp.error) : null;
  // 変更を申請中なら、申請した内容から続けて直せるようにする
  const initial = toFormValues(pendingRevision ? (pendingRevision.data as MenuInput) : menuToInput(menu));

  return (
    <div className="space-y-4">
      <PageHeader
        back={{ href: '/partner/plans', label: 'プランの一覧へ' }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {splitPlanTitle(menu.translation.title).title}
            <span className={cn('rounded-full px-2.5 py-0.5 text-sm font-semibold', PLAN_STATE_TONE[state])}>
              {PLAN_STATE_LABELS[state]}
            </span>
          </span>
        }
        actions={
          <>
            {live && (
              <a
                href={`/ja/menus/${menu.slug}`}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                公開ページ ↗
              </a>
            )}
            <Link href={`/partner/plans/${menu.id}/schedule`} className={buttonVariants({ size: 'sm' })}>
              開催時間・空き枠
            </Link>
          </>
        }
      />
      <div className="max-w-2xl space-y-4">
        {sp.saved && <Notice tone="success">保存しました。</Notice>}
        {sp.requested && (
          <Notice tone="success">
            変更を申請しました。組合が承認するまで、今の内容のまま公開しています（結果はメールでもお知らせします）。
          </Notice>
        )}
        {done && <Notice tone="success">{done}</Notice>}
        {error && <Notice tone="error">{error}</Notice>}

        <Panel title="公開の状態">
          {state === 'draft' && (
            <div className="space-y-3 text-sm">
              <p>
                下書きです。内容・料金・写真と開催時間を登録したら、公開を申請してください。組合が確認してから公開します。
              </p>
              {!hasSchedule && (
                <p className="text-amber-800">
                  開催時間がまだありません。
                  <Link href={`/partner/plans/${menu.id}/schedule`} className="ml-1 font-semibold underline">
                    開催時間・空き枠
                  </Link>
                  で登録してください。
                </p>
              )}
              <form action={requestPublishAction.bind(null, menu.id)}>
                <SubmitButton disabled={!hasSchedule} pendingLabel="申請中…">
                  公開を申請する
                </SubmitButton>
              </form>
            </div>
          )}
          {state === 'rejected' && (
            <div className="space-y-3 text-sm">
              <Notice tone="warning">
                <span className="block font-semibold">
                  組合から差し戻しがありました。内容を直して、もう一度申請してください。
                </span>
                <span className="mt-1 block whitespace-pre-line">{menu.reviewNote}</span>
              </Notice>
              <form action={requestPublishAction.bind(null, menu.id)}>
                <SubmitButton disabled={!hasSchedule} pendingLabel="申請中…">
                  直したので、もう一度公開を申請する
                </SubmitButton>
              </form>
            </div>
          )}
          {state === 'publish_pending' && (
            <div className="space-y-3 text-sm">
              <p>
                公開を申請中です{menu.reviewRequestedAt && `（${at(menu.reviewRequestedAt)}）`}
                。組合の確認をお待ちください。申請中も内容は直せます。
              </p>
              <form action={withdrawPublishAction.bind(null, menu.id)}>
                <SubmitButton variant="outline" pendingLabel="取り下げ中…">
                  申請を取り下げる
                </SubmitButton>
              </form>
            </div>
          )}
          {live && (
            <div className="space-y-3 text-sm">
              <p>
                {state === 'published'
                  ? '公開中です。お客様のサイトに表示し、申込を受け付けています。'
                  : '受付を一時停止しています。ページは見られますが、新しい申込は受け付けません。'}
              </p>
              <p className="text-slate-600">
                開催時間・休み・定員の変更と、受付の一時停止はすぐ反映します。内容・料金・写真の変更は、組合が承認してから反映します。
              </p>
              {state === 'published' ? (
                <form action={pausePlanAction.bind(null, menu.id)}>
                  <ConfirmDialog
                    tone="default"
                    triggerLabel="受付を一時停止する"
                    title="受付を一時停止しますか？"
                    confirmLabel="一時停止する"
                  >
                    <p>
                      ページは公開したまま、新しい申込だけを止めます（機材の故障・準備中など）。入っている予約はそのままです。
                    </p>
                  </ConfirmDialog>
                </form>
              ) : menu.pausedBy === 'operator' ? (
                <form action={resumePlanAction.bind(null, menu.id)}>
                  <SubmitButton pendingLabel="再開中…">受付を再開する</SubmitButton>
                </form>
              ) : (
                <p className="rounded-lg bg-amber-50 p-3 text-amber-900">
                  組合が受付を止めています。再開するときは、組合へご連絡ください。
                </p>
              )}
            </div>
          )}
          {state === 'archived' && (
            <p className="text-sm">掲載を終えたプランです。もう一度載せるときは、組合へご連絡ください。</p>
          )}
        </Panel>

        {pendingRevision && (
          <Notice tone="info">
            <span className="block font-semibold">
              内容の変更を申請中です（{at(pendingRevision.updatedAt)}）。組合が承認するまで、今の内容で公開しています。
            </span>
            <span className="mt-1 block">下のフォームは申請した内容です。直して保存すると、申請を出し直します。</span>
            <form action={withdrawRevisionAction.bind(null, menu.id)} className="mt-2">
              <SubmitButton variant="outline" pendingLabel="取り下げ中…">
                変更の申請を取り下げる
              </SubmitButton>
            </form>
          </Notice>
        )}
        {!pendingRevision && rejectedRevision && (
          <Notice tone="warning">
            <span className="block font-semibold">前回の変更の申請は差し戻されました。</span>
            <span className="mt-1 block whitespace-pre-line">{rejectedRevision.reviewNote}</span>
          </Notice>
        )}
      </div>

      {state !== 'archived' && (
        <MenuForm
          key={
            typeof sp.saved === 'string'
              ? sp.saved
              : pendingRevision
                ? `rev-${pendingRevision.updatedAt.getTime()}`
                : 'initial'
          }
          mode="operator"
          action={savePlanAction.bind(null, menu.id)}
          uploadImage={uploadPlanImageAction}
          operators={[]}
          activities={activities.filter((a) => a.status === 'published' || a.id === menu.activityId)}
          unitLocked={hasBookings}
          submitLabel={live ? '変更を申請する' : '保存'}
          noteField={
            live
              ? { label: '組合へのひとこと（変更の理由など・任意）', defaultValue: pendingRevision?.note ?? '' }
              : undefined
          }
          initial={initial}
          // 公開中の変更の申請：開いたあとに組合がプランを直していたら、申請せずに開き直してもらう
          hiddenFields={{ seenUpdatedAt: menu.updatedAt.toISOString() }}
        />
      )}
    </div>
  );
}
