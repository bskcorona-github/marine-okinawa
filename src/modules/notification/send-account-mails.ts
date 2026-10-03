import { createElement } from 'react';
import { eq } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import { shops } from '@/db/schema';
import { formatDateLabel, localTime } from '@/lib/dates';
import { resolveSettings } from '@/modules/shop/settings';
import { BookingEmail } from './booking-email';
import { deliverEmail, type SendResult } from './booking-email-common';
import type { Mailer } from './mailer';
import { recipientName } from './recipient-name';

/**
 * パスワードを決めるリンクのメール。
 * - invite：組合がアカウントを作った（application：登録申請を承認して作った）
 * - reset：組合がアカウントを再発行した（認証アプリの設定も外した）
 * - forgot：本人が「パスワードを忘れたとき」から頼んだ
 * リンクには秘密の値が入るので、記録（notifications）には残さない
 */
export type PasswordLinkKind = 'invite' | 'application' | 'reset' | 'forgot';

export async function sendPasswordLinkMail(
  db: DbOrTx,
  mailer: Mailer,
  params: {
    shopId: string;
    kind: PasswordLinkKind;
    to: string;
    name: string;
    url: string;
    expiresAt: Date;
    /** 事業者の名前（事業者のアカウントのとき） */
    operatorName?: string | null;
    appUrl: string;
  },
): Promise<SendResult> {
  const [shop] = await db
    .select({ name: shops.name, profile: shops.profile, settings: shops.settings, timezone: shops.timezone })
    .from(shops)
    .where(eq(shops.id, params.shopId));
  if (!shop) return { status: 'skipped' };
  const settings = resolveSettings(shop.settings);
  const expires = `${formatDateLabel(params.expiresAt, shop.timezone)} ${localTime(params.expiresAt, shop.timezone)} まで`;
  const invite = params.kind === 'invite' || params.kind === 'application';
  const subject = invite ? `【事業者画面のご案内】${settings.siteName}` : `【パスワードの再設定】${settings.siteName}`;
  const intro = {
    application: `事業者の登録申請を承認しました。${shop.name}の事業者画面（受入確認への回答・催行報告・プランの登録など）をお使いいただけます。下のボタンから、ご自分のパスワードを決めてください。`,
    invite: `${shop.name}の事業者画面のアカウントを用意しました。下のボタンから、ご自分のパスワードを決めてください。`,
    reset: `${shop.name}の担当者の操作で、パスワードの再設定のご案内をお送りします。下のボタンから、新しいパスワードを決めてください。認証アプリ（2 要素認証）の設定も外しましたので、次のログインで設定し直してください。`,
    forgot:
      'パスワードの再設定のご依頼を受け付けました。下のボタンから、新しいパスワードを決めてください。お心当たりのない場合は、このメールを破棄してください（パスワードは変わりません）。',
  }[params.kind];
  return deliverEmail(
    db,
    mailer,
    { shopId: params.shopId, bookingId: null, customerId: null, locale: 'ja' },
    {
      type: invite ? 'account_invite' : 'password_reset',
      to: params.to,
      replyTo: shop.profile.email,
      subject,
      react: createElement(BookingEmail, {
        preview: subject,
        greeting: recipientName(params.name),
        intro,
        rows: [
          ...(params.operatorName ? [{ label: '事業者', value: params.operatorName }] : []),
          { label: 'ログイン用のメールアドレス', value: params.to },
          { label: 'リンクの有効期限', value: `${expires}（1 回だけ使えます）` },
          { label: 'ログインの画面', value: `${params.appUrl.replace(/\/$/, '')}/admin/login` },
        ],
        buttonLabel: invite ? 'パスワードを決める' : '新しいパスワードを決める',
        buttonUrl: params.url,
        footer: invite
          ? `パスワードを決めたら、ログインの画面からログインしてください。初めてのログインでは、スマホの認証アプリ（Google Authenticator など）で 2 要素認証を設定していただきます。リンクの期限が切れたときは、${shop.name}の担当者へご連絡ください。（このメールは自動送信です）`
          : 'リンクの期限が切れたときは、ログインの画面の「パスワードを忘れたとき」から、もう一度お申し込みください。（このメールは自動送信です）',
      }),
    },
  );
}

/** 事業者の登録申請を見送ったことを、申請者に知らせる（組合のメモは載せない） */
export async function sendApplicationRejectedMail(
  db: DbOrTx,
  mailer: Mailer,
  params: { shopId: string; to: string; name: string; companyName: string },
): Promise<SendResult> {
  const [shop] = await db
    .select({ name: shops.name, profile: shops.profile, settings: shops.settings })
    .from(shops)
    .where(eq(shops.id, params.shopId));
  if (!shop) return { status: 'skipped' };
  const settings = resolveSettings(shop.settings);
  const subject = `【事業者の登録申請の結果】${settings.siteName}`;
  return deliverEmail(
    db,
    mailer,
    { shopId: params.shopId, bookingId: null, customerId: null, locale: 'ja' },
    {
      type: 'application_result',
      to: params.to,
      replyTo: shop.profile.email,
      subject,
      react: createElement(BookingEmail, {
        preview: subject,
        greeting: recipientName(params.name),
        intro:
          '事業者の登録申請をお送りいただき、ありがとうございました。内容を確認いたしましたが、誠に恐れ入りますが、今回は登録を見送らせていただくことになりました。詳しくは、このメールへの返信でお問い合わせください。',
        rows: [{ label: '事業者名', value: params.companyName }],
        footer: `${shop.name}（このメールは自動送信です）`,
      }),
    },
  );
}
