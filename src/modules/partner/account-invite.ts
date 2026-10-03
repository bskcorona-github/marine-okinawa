import 'server-only';
import type { Db } from '@/db/client';
import { getEnv } from '@/lib/env';
import { createInviteToken, inviteUrl } from '@/modules/auth/auth-links';
import type { SendResult } from '@/modules/notification/booking-email-common';
import { sendPasswordLinkMail } from '@/modules/notification/send-account-mails';
import { sendQuietly } from '@/modules/notification/send-quietly';

/** invite：組合がアカウントを作った。application：登録申請を承認して作った。reset：組合が再発行した */
export type InviteKind = 'invite' | 'application' | 'reset';

export type InviteResult = {
  status: SendResult['status'];
  /**
   * 組合の画面に出すリンク（メールが届かなかったとき・メールを送らない設定の開発環境だけ。手で事業者に送れるように）。
   * 届いたときは出さない（リンクを知る人を増やさない）
   */
  link: string | null;
};

/** 招待のリンクを作り、メールで送る（ボタンを押すと、LINE・Google をつなぐかパスワードを決める画面へ進む） */
export async function sendAccountInvite(
  db: Db,
  params: { shopId: string; email: string; name: string; operatorName: string | null; kind: InviteKind },
): Promise<InviteResult> {
  const env = getEnv();
  const { token, expiresAt } = await createInviteToken(params.email, params.name);
  const url = inviteUrl(env.APP_URL, token);
  const result = await sendQuietly('mail.account_invite.failed', { kind: params.kind }, (mailer, appUrl) =>
    sendPasswordLinkMail(db, mailer, {
      shopId: params.shopId,
      kind: params.kind,
      to: params.email,
      name: params.name,
      url,
      expiresAt,
      operatorName: params.operatorName,
      appUrl,
    }),
  );
  return { status: result.status, link: result.status !== 'sent' || env.MAIL_DRIVER === 'log' ? url : null };
}
