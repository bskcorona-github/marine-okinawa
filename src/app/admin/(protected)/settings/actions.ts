'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import { invalidState, toFormIssues, type AdminFormState } from '@/lib/zod-ja';
import { requireAdmin } from '@/modules/auth/guard';
import { settingsSchema } from '@/modules/shop/settings';
import { shopSettingsSchema, updateShopSettings } from '@/modules/shop/shops';

const FIELD_LABELS: Record<string, string> = {
  name: '運営者名（組合名）',
  siteName: 'サイト名',
  priceLabel: '料金の見出し',
  paymentInstructions: '支払方法の案内',
  paymentDueDays: '支払期限（日数）',
  commonCancellationPolicy: '共通のキャンセル規定',
  commonWeatherPolicy: '天候・海況による中止の扱い（共通）',
  bookingPausedMessage: '受付停止中の案内文',
  adminNotifyEmail: '新規申込の通知先',
  replyGuide: 'ご連絡の目安',
  autoRequestOwner: '自動の受入確認',
  commissionRate: '組合の手数料率',
  cancelFreeDays: 'キャンセル料が無料の日数',
  cancelMidPercent: '前日までのキャンセル料率',
  cancelSameDayPercent: '当日・無断のキャンセル料率',
  weatherRefundPercent: '天候中止の返金率',
  cancellationFeeToOperator: 'キャンセル料の配分',
  payoutDay: '事業者への支払日',
  invoiceNumber: '組合のインボイスの登録番号',
  receiptModel: '領収書の型',
  settlementStartMonth: '精算を始める月',
  phone: '電話番号',
  email: 'お問い合わせ用のメールアドレス',
  businessHours: '受付時間',
  introduction: '紹介文',
  address: '住所',
  landmark: '目印',
  parking: '駐車場',
  directions: '行き方',
  nearbyHotels: '近くのホテル',
  lowStockThresholdPercent: '「残りわずか」の基準（%）',
  lowStockThresholdCount: '「残りわずか」の基準（名）',
};

export async function updateSettingsAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const admin = await requireAdmin();
  const raw = Object.fromEntries(formData);
  const parsed = shopSettingsSchema.safeParse(raw);
  const settings = settingsSchema.safeParse(raw);
  if (!parsed.success || !settings.success) {
    const issues = [
      ...(parsed.success ? [] : toFormIssues(parsed.error, FIELD_LABELS)),
      ...(settings.success ? [] : toFormIssues(settings.error, FIELD_LABELS)),
    ];
    return invalidState(issues);
  }
  await updateShopSettings(db, admin.shopId, parsed.data, settings.data, admin.userId);
  revalidatePath('/', 'layout');
  // saved に時刻を入れて、保存後にフォームを作り直す（未保存の印を消す）
  redirect(`/admin/settings?saved=${Date.now()}`);
}
