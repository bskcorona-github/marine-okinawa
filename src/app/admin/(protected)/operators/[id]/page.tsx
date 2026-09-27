import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { db } from '@/db';
import { addDays, localDate } from '@/lib/dates';
import { isUuid } from '@/lib/validation';
import { requireAdmin } from '@/modules/auth/guard';
import { formatPeriodLines, getOperatorForAdmin } from '@/modules/catalog/operator-admin';
import { SLOT_HORIZON_DAYS } from '@/modules/schedule/sync-slots';
import { getShopById } from '@/modules/shop/shops';
import { updateOperatorAction } from '../actions';

export const metadata = { title: '提供事業者の編集' };

export default async function OperatorPage({ params, searchParams }: PageProps<'/admin/operators/[id]'>) {
  const admin = await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  const [shop, op] = await Promise.all([getShopById(db, admin.shopId), getOperatorForAdmin(db, admin.shopId, id)]);
  if (!op) notFound();

  const horizonEnd = addDays(localDate(new Date(), shop.timezone), SLOT_HORIZON_DAYS - 1);
  const lastPeriodEnd = op.periods.at(-1)?.endDate ?? null;

  return (
    <div className="max-w-2xl space-y-4">
      <Link href="/admin/operators" className="text-sm text-slate-600">
        ← 事業者一覧へ
      </Link>
      <h1 className="text-xl font-bold">{op.name}</h1>
      {sp.saved && <p className="rounded bg-emerald-50 p-3 text-sm text-emerald-900">保存しました。</p>}
      {typeof sp.error === 'string' && <p className="rounded bg-red-50 p-3 text-sm text-red-800">{sp.error}</p>}
      {lastPeriodEnd && lastPeriodEnd < horizonEnd && (
        <p className="rounded bg-amber-50 p-3 text-sm text-amber-900">
          オン期は {lastPeriodEnd} まで登録されています。予約受付は {horizonEnd}{' '}
          まで開いているため、それ以降のオン期がある場合は追加してください（未登録の日はオフ期料金になります）。
        </p>
      )}
      <form
        action={updateOperatorAction.bind(null, op.id)}
        className="space-y-4 rounded-lg border bg-white p-4 text-sm"
      >
        <label className="block space-y-1">
          <span className="block font-medium">事業者名</span>
          <Input name="name" defaultValue={op.name} required />
        </label>
        <label className="block space-y-1">
          <span className="block font-medium">紹介文</span>
          <Textarea name="about" rows={4} defaultValue={op.about} />
        </label>
        <label className="block space-y-1">
          <span className="block font-medium">予約締切の案内</span>
          <Input name="bookingDeadlineNote" defaultValue={op.bookingDeadlineNote} />
        </label>
        <label className="block space-y-1">
          <span className="block font-medium">キャンセル規定（プランの詳細ページに表示）</span>
          <Textarea name="cancellationPolicy" rows={4} defaultValue={op.cancellationPolicy} />
        </label>
        <label className="block space-y-1">
          <span className="block font-medium">天候・海況による中止</span>
          <Textarea name="weatherPolicy" rows={3} defaultValue={op.weatherPolicy} />
        </label>
        <label className="block space-y-1">
          <span className="block font-medium">画像の URL（1 行に 1 つ）</span>
          <Textarea name="images" rows={3} defaultValue={op.images.join('\n')} className="font-mono text-xs" />
        </label>
        <label className="block space-y-1">
          <span className="block font-medium">
            オン期の期間（1 行に 1 期間。例：2027-04-25〜2027-04-30、1 日だけなら 2027-06-06）
          </span>
          <Textarea
            name="periods"
            rows={8}
            defaultValue={formatPeriodLines(op.periods)}
            className="font-mono text-xs"
          />
          <span className="block text-xs text-slate-500">
            料金区分で「オン期」「オフ期」を設定したプランは、この期間に含まれる日はオン期料金、それ以外はオフ期料金になります。
          </span>
        </label>
        <Button type="submit">保存</Button>
      </form>
    </div>
  );
}
