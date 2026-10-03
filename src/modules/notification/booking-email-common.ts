import { eq } from 'drizzle-orm';
import type { ReactElement } from 'react';
import type { DbOrTx } from '@/db/client';
import { notifications, type notificationType } from '@/db/schema';
import type { BookingSummary } from '@/modules/booking/queries';
import { dayOfContact, shopContact, type Contact } from '@/modules/shop/contact';
import { MailTimeoutError, type Mailer } from './mailer';
import { formatPartyItems } from '@/modules/booking/party';
import { logWarn } from '@/lib/log';
import { isFeatureOn } from '@/modules/shop/features';

/** unknown：送信サービスの応答がなく、送れたかどうか分からない */
export type SendResult = { status: 'sent' | 'failed' | 'skipped' | 'unknown' };

export type NotificationType = (typeof notificationType.enumValues)[number];

function contactText(contact: Contact | null): string {
  if (!contact) return '';
  const phone =
    [contact.name, contact.phone].filter(Boolean).join(' ') +
    (contact.phone && contact.hours ? `（${contact.hours}）` : '');
  return [phone, contact.email].filter(Boolean).join(' / ');
}

/** お問い合わせ・キャンセル・変更の窓口（組合）の 1 行 */
export function shopContactLine(booking: BookingSummary): string {
  return contactText(shopContact(booking));
}

/** 当日の連絡先（実施事業者）の 1 行。予約確定後のメールだけで使う */
export function dayOfContactLine(booking: BookingSummary): string {
  return contactText(dayOfContact(booking));
}

/** 人数の表示（例：大人 2名、子供 1名） */
export function peopleLine(booking: Pick<BookingSummary, 'items' | 'capacityUnit'>): string {
  return formatPartyItems(booking.items, booking.capacityUnit, { separator: '、' });
}

/**
 * メールを送り、結果を notifications に記録する（予約・お問い合わせのメール）。
 * 操作自体は完了しているので、送信に失敗しても例外は投げない
 */
export async function deliverEmail(
  db: DbOrTx,
  mailer: Mailer,
  target: { shopId: string; bookingId: string | null; customerId: string | null; locale: string },
  message: {
    type: NotificationType;
    to: string;
    subject: string;
    react: ReactElement;
    /** 返信先。お客様へのメールは組合の問い合わせ用アドレス、組合への通知はお客様のアドレスなど */
    replyTo?: string | null;
    idempotencyKey?: string;
  },
): Promise<SendResult> {
  const [notification] = await db
    .insert(notifications)
    .values({
      shopId: target.shopId,
      bookingId: target.bookingId,
      customerId: target.customerId,
      type: message.type,
      toEmail: message.to,
      locale: target.locale,
    })
    .returning({ id: notifications.id });

  // 「機能の切り替え」でメールを止めているあいだは、送らずに「送れなかった」として残す（あとで送り直せる）
  if (!(await isFeatureOn(db, target.shopId, 'mail.send'))) {
    await db
      .update(notifications)
      .set({ status: 'failed', error: 'メールの送信を止めています（機能の切り替え）' })
      .where(eq(notifications.id, notification.id));
    return { status: 'failed' };
  }
  try {
    const { id } = await mailer.send({
      to: message.to,
      subject: message.subject,
      replyTo: message.replyTo || undefined,
      react: message.react,
      idempotencyKey: message.idempotencyKey ?? notification.id,
    });
    await db
      .update(notifications)
      .set({ status: 'sent', providerMessageId: id, sentAt: new Date() })
      .where(eq(notifications.id, notification.id));
    return { status: 'sent' };
  } catch (error) {
    const timedOut = error instanceof MailTimeoutError;
    // 送信サービスの障害（キーの失効など）に気づけるよう、実行のログにも出す（宛先は出さない）
    logWarn(
      timedOut ? 'mail.send.unknown' : 'mail.send.failed',
      { notificationId: notification.id, bookingId: target.bookingId, kind: message.type },
      error,
    );
    const text = error instanceof Error ? error.message : String(error);
    await db
      .update(notifications)
      .set({ status: timedOut ? 'unknown' : 'failed', error: text.slice(0, 500) })
      .where(eq(notifications.id, notification.id));
    return { status: timedOut ? 'unknown' : 'failed' };
  }
}

/** 予約のメールを送る（送信先は message.to。記録は予約に紐づける） */
export function deliverBookingEmail(
  db: DbOrTx,
  mailer: Mailer,
  booking: Pick<BookingSummary, 'id' | 'shopId' | 'customerId' | 'locale'>,
  message: Parameters<typeof deliverEmail>[3],
): Promise<SendResult> {
  return deliverEmail(
    db,
    mailer,
    { shopId: booking.shopId, bookingId: booking.id, customerId: booking.customerId, locale: booking.locale },
    message,
  );
}
