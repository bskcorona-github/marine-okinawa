import { index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './_columns';
import { bookings } from './booking';
import { customers } from './customer';
import { shops } from './shop';

// requested：受付完了（まだ確定していない）、payment_request：支払案内、admin_new_request：組合への新規申込通知、
// inquiry_received / inquiry_ack：お問い合わせの組合への通知 / お客様への受付メール
// operator_request / operator_response / operator_booking：事業者への受入確認の依頼 / 組合への事業者の回答 / 事業者への確定・取消の連絡
// operator_application / application_ack：事業者の登録申請の組合への通知 / 申請者への受付メール
// payment_issue：カード決済が済んだが自動で確定できなかった（確認・返金が要る）ことの組合への通知
export const notificationType = pgEnum('notification_type', [
  'requested',
  'payment_request',
  'admin_new_request',
  'inquiry_received',
  'inquiry_ack',
  'operator_request',
  'operator_response',
  'operator_booking',
  'operator_application',
  'application_ack',
  'plan_review',
  'plan_review_result',
  'payment_issue',
  'confirmed',
  'reminder',
  'weather_cancel',
  'cancelled',
  'refunded',
  'apology',
]);
// unknown：送信サービスの応答がなく、届いたかどうか分からない
export const notificationStatus = pgEnum('notification_status', ['queued', 'sent', 'failed', 'bounced', 'unknown']);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid().primaryKey().defaultRandom(),
    shopId: uuid()
      .notNull()
      .references(() => shops.id),
    bookingId: uuid().references(() => bookings.id),
    customerId: uuid().references(() => customers.id),
    type: notificationType().notNull(),
    toEmail: text().notNull(),
    locale: text().notNull(),
    status: notificationStatus().notNull().default('queued'),
    providerMessageId: text(),
    error: text(),
    sentAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('notifications_booking_idx').on(t.bookingId),
    // 管理画面の「メールの送信記録」（新しい順・送れなかったもの）
    index('notifications_shop_status_idx').on(t.shopId, t.status, t.createdAt),
    index('notifications_shop_created_idx').on(t.shopId, t.createdAt),
  ],
);
