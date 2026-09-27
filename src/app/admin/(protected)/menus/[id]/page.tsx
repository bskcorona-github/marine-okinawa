import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { isUuid } from '@/lib/validation';
import { requireAdmin } from '@/modules/auth/guard';
import { getMenuForAdmin, listOperators } from '@/modules/catalog/menus';
import { updateMenuAction } from '../actions';
import { MenuForm } from '../menu-form';

export const metadata = { title: 'メニューの編集' };

export default async function EditMenuPage({ params, searchParams }: PageProps<'/admin/menus/[id]'>) {
  const admin = await requireAdmin();
  const { id } = await params;
  const { saved } = await searchParams;
  if (!isUuid(id)) notFound();
  const [menu, operators] = await Promise.all([getMenuForAdmin(db, admin.shopId, id), listOperators(db, admin.shopId)]);
  if (!menu) notFound();

  return (
    <div className="space-y-4">
      <Link href="/admin/menus" className="text-sm text-slate-600">
        ← メニュー一覧へ
      </Link>
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-bold">{menu.translation.title}</h1>
        <Link href={`/admin/menus/${menu.id}/schedule`} className="text-sm underline">
          回の設定へ
        </Link>
      </div>
      {saved && <p className="rounded bg-emerald-50 p-3 text-sm text-emerald-900">保存しました。</p>}
      <MenuForm
        action={updateMenuAction.bind(null, menu.id)}
        operators={operators}
        submitLabel="保存"
        initial={{
          slug: menu.slug,
          status: menu.status,
          category: menu.category,
          durationMin: menu.durationMin,
          minAge: menu.minAge,
          maxPartySize: menu.maxPartySize,
          bookingCutoffMin: menu.bookingCutoffMin,
          cutoffPrevDayTime: menu.cutoffPrevDayTime,
          operatorId: menu.operatorId,
          capacityUnit: menu.capacityUnit === '艇' ? '艇' : '名',
          title: menu.translation.title,
          description: menu.translation.description,
          meetingPoint: menu.translation.meetingPoint,
          whatToBring: menu.translation.whatToBring,
          summary: menu.translation.summary,
          included: menu.translation.included,
          conditions: menu.translation.conditions,
          notes: menu.translation.notes,
          images: menu.images.map((i) => i.url),
          prices: menu.prices,
        }}
      />
    </div>
  );
}
