import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { db } from '@/db';
import { requireAdmin } from '@/modules/auth/guard';
import { getShopById } from '@/modules/shop/shops';
import { updateSettingsAction } from './actions';

export const metadata = { title: '設定' };

export default async function SettingsPage({ searchParams }: PageProps<'/admin/settings'>) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const shop = await getShopById(db, admin.shopId);

  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-xl font-bold">設定</h1>
      {sp.saved && <p className="rounded bg-emerald-50 p-3 text-sm text-emerald-900">保存しました。</p>}
      {sp.error && <p className="rounded bg-red-50 p-3 text-sm text-red-800">入力内容を確認してください。</p>}
      <form action={updateSettingsAction} className="space-y-4 rounded-lg border bg-white p-4 text-sm">
        <label className="block space-y-1">
          <span className="block font-medium">ショップ名</span>
          <Input name="name" defaultValue={shop.name} required />
        </label>
        <fieldset className="space-y-2">
          <legend className="font-medium">「残りわずか（△）」の表示基準</legend>
          <p className="text-xs text-slate-500">どちらかを満たすと △ になります。</p>
          <div className="flex flex-wrap items-center gap-2">
            残り枠が定員の
            <Input
              name="lowStockThresholdPercent"
              type="number"
              min={0}
              max={100}
              defaultValue={shop.lowStockThresholdPercent}
              className="w-20"
            />
            % 以下、または
            <Input
              name="lowStockThresholdCount"
              type="number"
              min={0}
              max={100}
              defaultValue={shop.lowStockThresholdCount}
              className="w-20"
            />
            名以下
          </div>
        </fieldset>
        <Button type="submit">保存</Button>
      </form>
      <p className="text-xs text-slate-500">タイムゾーン：{shop.timezone}（変更不可）</p>
    </div>
  );
}
