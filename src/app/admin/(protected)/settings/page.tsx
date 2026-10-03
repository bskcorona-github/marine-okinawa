import { Notice, PageHeader } from '@/components/backoffice/page-header';
import { db } from '@/db';
import { requireAdmin } from '@/modules/auth/guard';
import { cardPaymentsActive } from '@/modules/payment/card-payments';
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
        {(await cardPaymentsActive(db, shop.id)) ? (
          <Notice tone="info">
            カード決済（Stripe）が有効です。支払案内のメールと予約確認ページに「カードで支払う」を出し、決済が済んだら自動で予約確定にします（下の「支払方法の案内」の文面は使いません）。
          </Notice>
        ) : (
          <Notice tone="warning">
            カード決済はまだ使えるようになっていません。今は「支払方法の案内」の振込先で受け付けます。カード決済を始めるには、システムの担当者に
            Stripe の設定を依頼してください。
          </Notice>
        )}
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
