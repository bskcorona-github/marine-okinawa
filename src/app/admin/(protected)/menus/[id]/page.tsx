import { buttonVariants } from '@/components/ui/button';
import { splitPlanTitle } from '@/modules/catalog/display-title';
import { Notice, PageHeader } from '@/components/admin/page-header';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { isUuid } from '@/lib/validation';
import { requireAdmin } from '@/modules/auth/guard';
import { listActivitiesForAdmin } from '@/modules/catalog/activities';
import { getMenuForAdmin, listOperators } from '@/modules/catalog/menus';
import { updateMenuAction, uploadMenuImageAction } from '../actions';
import { listMenuCandidates } from '@/modules/partner/requests';
import { countUpcomingBookings, menuHasBookings } from '@/modules/booking/queries';
import { MenuForm } from '../menu-form';
import { formatDateLabel, localTime } from '@/lib/dates';
import { ownValue } from '@/lib/own';
import { getPendingRevision, PLAN_ERROR_LABELS } from '@/modules/catalog/operator-plans';
import { getShopById } from '@/modules/shop/shops';
import { ReviewPanel } from './review-panel';

const REVIEWED: Record<string, string> = {
  'publish-approved': '公開を承認し、プランを公開しました。事業者にメールで知らせました。',
  'publish-rejected': '公開の申請を差し戻しました。事業者にメールで知らせました。',
  'revision-approved': '変更を承認し、プランに反映しました。事業者にメールで知らせました。',
  'revision-rejected': '変更の申請を差し戻しました。事業者にメールで知らせました。',
};

export const metadata = { title: 'プランの編集' };

export default async function EditMenuPage({ params, searchParams }: PageProps<'/admin/menus/[id]'>) {
  const admin = await requireAdmin();
  const { id } = await params;
  const { saved, reviewed, reviewError } = await searchParams;
  if (!isUuid(id)) notFound();
  const [menu, operators, activities, upcomingBookings, hasBookings, candidates, revision, shop] = await Promise.all([
    getMenuForAdmin(db, admin.shopId, id),
    listOperators(db, admin.shopId),
    listActivitiesForAdmin(db, admin.shopId),
    countUpcomingBookings(db, { menuId: id, now: new Date() }),
    menuHasBookings(db, id),
    listMenuCandidates(db, { shopId: admin.shopId, menuId: id, includeSuspended: true }),
    getPendingRevision(db, id),
    getShopById(db, admin.shopId),
  ]);
  if (!menu) notFound();
  const at = (d: Date) => `${formatDateLabel(d, shop.timezone)} ${localTime(d, shop.timezone)}`;
  const reviewedText = ownValue(REVIEWED, reviewed);
  const reviewErrorText = typeof reviewError === 'string' ? ownValue<string>(PLAN_ERROR_LABELS, reviewError) : null;

  return (
    <div className="space-y-4">
      <PageHeader
        back={{ href: '/admin/menus', label: 'プラン一覧へ' }}
        title={splitPlanTitle(menu.translation.title).title}
        description="お客様向けのプランページに表示する内容と料金を編集します。"
        actions={
          <>
            {(menu.status === 'published' || menu.status === 'paused') && (
              <a
                href={`/ja/menus/${menu.slug}`}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                公開ページ ↗
              </a>
            )}
            <Link href={`/admin/menus/${menu.id}/schedule`} className={buttonVariants({ size: 'sm' })}>
              回の設定へ
            </Link>
          </>
        }
      />
      {reviewedText ? (
        <Notice tone="success">{reviewedText}</Notice>
      ) : (
        saved && <Notice tone="success">保存しました。</Notice>
      )}
      {reviewErrorText && <Notice tone="error">{reviewErrorText}</Notice>}
      <ReviewPanel
        menu={menu}
        revision={revision}
        operatorName={operators.find((o) => o.id === menu.operatorId)?.name ?? null}
        at={at}
        activityName={(activityId) => activities.find((a) => a.id === activityId)?.name ?? '（未設定）'}
      />
      <MenuForm
        key={typeof saved === 'string' ? saved : 'initial'}
        action={updateMenuAction.bind(null, menu.id)}
        uploadImage={uploadMenuImageAction}
        operators={operators}
        activities={activities}
        upcomingBookings={upcomingBookings}
        unitLocked={hasBookings}
        submitLabel="保存"
        initial={{
          slug: menu.slug,
          status: menu.status,
          category: menu.category,
          durationMin: menu.durationMin,
          minAge: menu.minAge,
          maxPartySize: menu.maxPartySize,
          minPartySize: menu.minPartySize,
          bookingCutoffMin: menu.bookingCutoffMin,
          cutoffPrevDayTime: menu.cutoffPrevDayTime,
          operatorId: menu.operatorId,
          activityId: menu.activityId,
          featured: menu.featured,
          requireAges: menu.requireAges,
          capacityUnit: menu.capacityUnit === '艇' ? '艇' : '名',
          title: menu.translation.title,
          description: menu.translation.description,
          meetingPoint: menu.translation.meetingPoint,
          meetingAddress: menu.translation.meetingAddress,
          meetingMapUrl: menu.meetingMapUrl,
          whatToBring: menu.translation.whatToBring,
          cancellationPolicy: menu.translation.cancellationPolicy,
          weatherPolicy: menu.translation.weatherPolicy,
          summary: menu.translation.summary,
          included: menu.translation.included,
          conditions: menu.translation.conditions,
          notes: menu.translation.notes,
          images: menu.images.map((i) => i.url),
          prices: menu.prices,
          includedGuests: menu.includedGuests,
          extraGuestPrice: menu.extraGuestPrice,
          maxGuests: menu.maxGuests,
          candidateIds: candidates.map((c) => c.id),
        }}
      />
    </div>
  );
}
