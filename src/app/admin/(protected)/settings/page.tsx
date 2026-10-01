import { Notice, PageHeader } from '@/components/admin/page-header';
import { db } from '@/db';
import { requireAdmin } from '@/modules/auth/guard';
import { getShopById } from '@/modules/shop/shops';
import { updateSettingsAction } from './actions';
import { SettingsForm } from './settings-form';

export const metadata = { title: '設定' };

export default async function SettingsPage({ searchParams }: PageProps<'/admin/settings'>) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const shop = await getShopById(db, admin.shopId);
  const profile = shop.profile;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="設定"
        description="Web 申込の受付、料金・お支払いの文言、サイトと運営者の情報、空き状況の表示の設定です。"
      />
      <div className="space-y-4">
        {sp.saved && <Notice tone="success">保存しました。</Notice>}
        <SettingsForm
          key={typeof sp.saved === 'string' ? sp.saved : 'initial'}
          action={updateSettingsAction}
          initial={{
            name: shop.name,
            phone: profile.phone ?? '',
            email: profile.email ?? '',
            businessHours: profile.businessHours ?? '',
            introduction: profile.introduction ?? '',
            address: profile.address ?? '',
            landmark: profile.landmark ?? '',
            parking: profile.parking ?? '',
            directions: profile.directions ?? [],
            nearbyHotels: profile.nearbyHotels ?? [],
            lowStockThresholdPercent: shop.lowStockThresholdPercent,
            lowStockThresholdCount: shop.lowStockThresholdCount,
            timezone: shop.timezone,
            settings: shop.settings,
          }}
        />
      </div>
    </div>
  );
}
