import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { account, operatorMembers, operators, shopMembers, user } from '@/db/schema';
import { auth } from '@/lib/auth';
import { getEnv } from '@/lib/env';
import { sendPasswordLinkMail } from '@/modules/notification/send-account-mails';
import { sendQuietly } from '@/modules/notification/send-quietly';
import { sendAccountInvite } from '@/modules/partner/account-invite';
import { recordAuthEvent } from '@/modules/security/auth-events';
import { clientIp, consumeRateLimit } from '@/modules/security/rate-limit';
import { createPasswordResetToken, passwordResetUrl } from './auth-links';

/** 同じ端末（IP）から 1 時間に 10 回、同じメールアドレスへは 1 時間に 3 回まで */
const LIMITS = { ip: { limit: 10, windowSec: 3600 }, email: { limit: 3, windowSec: 3600 } };

/**
 * 「ログインできないとき」：本人の状態に合わせて、案内のメールを送る（登録の有無は画面に出さない）。
 * - パスワードを使っている：パスワードの再設定のリンク（2 要素認証の設定はそのまま。認証アプリは引き続き要る）
 * - まだログインの方法を決めていない（招待のリンクの期限切れなど）：招待のリンクを送り直す
 * - LINE・Google だけ：リンクは送らない（メールだけで、ほかの方法を足せないように）。画面で LINE などからのログインを案内する
 */
export async function requestLoginHelp(db: Db, input: { email: string; headers: Headers }): Promise<void> {
  const email = input.email.trim().toLowerCase();
  const ip = clientIp(input.headers) ?? 'unknown';
  const allowedIp = await consumeRateLimit(db, { key: `login-help-ip:${ip}`, ...LIMITS.ip });
  const allowedEmail = allowedIp && (await consumeRateLimit(db, { key: `login-help-email:${email}`, ...LIMITS.email }));
  const ctx = await auth.$context;
  await recordAuthEvent(db, {
    event: 'login_help.requested',
    userId: null,
    email,
    headers: input.headers,
    secret: ctx.secret,
  });
  if (!allowedEmail) return;

  const [found] = await db.select({ id: user.id, name: user.name }).from(user).where(eq(user.email, email));
  if (!found) return;
  const methods = (
    await db.select({ providerId: account.providerId }).from(account).where(eq(account.userId, found.id))
  ).map((m) => m.providerId);
  const [admin] = await db
    .select({ shopId: shopMembers.shopId })
    .from(shopMembers)
    .where(eq(shopMembers.userId, found.id));
  const [operator] = admin
    ? []
    : await db
        .select({ shopId: operatorMembers.shopId, operatorName: operators.name })
        .from(operatorMembers)
        .innerJoin(operators, eq(operators.id, operatorMembers.operatorId))
        .where(and(eq(operatorMembers.userId, found.id), isNull(operatorMembers.disabledAt)));
  const shopId = admin?.shopId ?? operator?.shopId;
  if (!shopId) return;

  if (methods.includes('credential')) {
    const { token, expiresAt } = await createPasswordResetToken(found.id);
    await sendQuietly('mail.password_reset.failed', { userId: found.id }, (mailer, appUrl) =>
      sendPasswordLinkMail(db, mailer, {
        shopId,
        kind: 'forgot',
        to: email,
        name: found.name,
        url: passwordResetUrl(getEnv().APP_URL, token),
        expiresAt,
        operatorName: operator?.operatorName ?? null,
        appUrl,
      }),
    );
    return;
  }
  if (methods.length === 0) {
    await sendAccountInvite(db, {
      shopId,
      email,
      name: found.name,
      operatorName: operator?.operatorName ?? null,
      kind: 'invite',
    });
  }
}
