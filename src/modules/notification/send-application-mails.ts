import { eq } from 'drizzle-orm';
import { createElement } from 'react';
import type { DbOrTx } from '@/db/client';
import { operatorApplications, shops } from '@/db/schema';
import { formatDateLabel, localTime } from '@/lib/dates';
import { resolveSettings } from '@/modules/shop/settings';
import { adminNotifyEmailOf } from '@/modules/shop/shops';
import { BookingEmail } from './booking-email';
import { deliverEmail, type SendResult } from './booking-email-common';
import type { Mailer } from './mailer';
import { recipientName } from './recipient-name';

/**
 * 事業者の登録申請の受付メール（申請者へ）と、組合への通知を送る。
 * 申請者への受付メールには、書かれた内容を載せない（他人のアドレスで任意の文面を送らせないため）
 */
export async function sendApplicationMails(
  db: DbOrTx,
  mailer: Mailer,
  params: { applicationId: string; appUrl: string },
): Promise<{ ack: SendResult; admin: SendResult }> {
  const [row] = await db
    .select({
      app: operatorApplications,
      shopName: shops.name,
      profile: shops.profile,
      settings: shops.settings,
      timezone: shops.timezone,
    })
    .from(operatorApplications)
    .innerJoin(shops, eq(shops.id, operatorApplications.shopId))
    .where(eq(operatorApplications.id, params.applicationId));
  if (!row) return { ack: { status: 'skipped' }, admin: { status: 'skipped' } };
  const { app } = row;
  const settings = resolveSettings(row.settings);
  const target = { shopId: app.shopId, bookingId: null, customerId: null, locale: 'ja' };
  const received = `${formatDateLabel(app.createdAt, row.timezone)} ${localTime(app.createdAt, row.timezone)}`;

  const ackSubject = `【事業者の登録申請を受け付けました】${settings.siteName}`;
  const ack = await deliverEmail(db, mailer, target, {
    type: 'application_ack',
    to: app.email,
    replyTo: row.profile.email,
    subject: ackSubject,
    react: createElement(BookingEmail, {
      preview: ackSubject,
      greeting: recipientName(app.contactName),
      intro:
        '事業者の登録申請をお送りいただき、ありがとうございます。組合で内容を確認し、担当者からご連絡します。お心当たりのない場合は、このメールを破棄してください。',
      rows: [{ label: '受付日時', value: received }],
      footer: `${row.shopName}（このメールは自動送信です）`,
    }),
  });

  const to = adminNotifyEmailOf({ settings, profile: row.profile });
  const adminSubject = `【事業者の登録申請】${app.companyName}`;
  const admin = to
    ? await deliverEmail(db, mailer, target, {
        type: 'operator_application',
        to,
        replyTo: app.email,
        subject: adminSubject,
        react: createElement(BookingEmail, {
          preview: adminSubject,
          greeting: row.shopName,
          intro: '事業者の登録申請が届きました。管理画面で内容と資料を確認してください。',
          rows: [
            { label: '事業者名', value: app.companyName },
            { label: '担当者', value: app.contactName },
            { label: '受付日時', value: received },
          ],
          buttonLabel: '管理画面で開く',
          buttonUrl: `${params.appUrl.replace(/\/$/, '')}/admin/operators/applications/${app.id}`,
          footer: 'このメールは自動送信です。申請者の連絡先は管理画面で確認してください。',
        }),
      })
    : ({ status: 'skipped' } as const);
  return { ack, admin };
}
