'use server';

import { headers } from 'next/headers';
import { db } from '@/db';
import { getEnv } from '@/lib/env';
import { createInquiry, inquiryInputSchema, sendInquiryMails } from '@/modules/content/inquiries';
import { getMailer } from '@/modules/notification/mailer';
import { clientIp, consumeRateLimit } from '@/modules/security/rate-limit';
import { getCurrentShop } from '@/modules/shop/shops';

/** 同じ IP からのお問い合わせは 10 分間に 3 件まで、同じメールアドレスは 1 時間に 3 件まで（迷惑な連投の対策） */
const INQUIRY_RATE_LIMIT = { limit: 3, windowSec: 600 };
const INQUIRY_EMAIL_LIMIT = { limit: 3, windowSec: 3600 };
/** IP が取れない環境では、全体で 10 分間に 30 件まで */
const INQUIRY_UNKNOWN_IP_LIMIT = { limit: 30, windowSec: 600 };

export type ContactState = { error: 'INVALID_INPUT' | 'AGREEMENT_REQUIRED' | 'RATE_LIMITED' | null; done?: boolean };

export async function submitInquiry(_prev: ContactState, formData: FormData): Promise<ContactState> {
  // 人には見えない欄に入力があれば、機械的な送信とみなして受け付けたふりをする
  if (String(formData.get('website') ?? '').trim()) return { error: null, done: true };
  const parsed = inquiryInputSchema.safeParse({
    kind: formData.get('kind'),
    name: formData.get('name') ?? '',
    email: String(formData.get('email') ?? '').trim(),
    phone: formData.get('phone') ?? '',
    message: formData.get('message') ?? '',
  });
  if (!parsed.success) return { error: 'INVALID_INPUT' };
  if (formData.get('agree') !== 'on') return { error: 'AGREEMENT_REQUIRED' };

  const ip = clientIp(await headers());
  if (!ip) console.warn('inquiry rate limit: client IP is unavailable, using the shared limit');
  const allowed =
    (await consumeRateLimit(
      db,
      ip ? { key: `inquiry:${ip}`, ...INQUIRY_RATE_LIMIT } : { key: 'inquiry:unknown-ip', ...INQUIRY_UNKNOWN_IP_LIMIT },
    )) &&
    (await consumeRateLimit(db, { key: `inquiry-email:${parsed.data.email.toLowerCase()}`, ...INQUIRY_EMAIL_LIMIT }));
  if (!allowed) return { error: 'RATE_LIMITED' };

  const shop = await getCurrentShop(db);
  const { id } = await createInquiry(db, { shopId: shop.id, input: parsed.data, now: new Date() });
  // 保存できていれば受付済み。メールの失敗で送信し直させない（同じお問い合わせが重ならないように）
  await sendInquiryMails(db, getMailer(), { inquiryId: id, appUrl: getEnv().APP_URL }).catch((error) =>
    console.error('inquiry mail failed', { inquiryId: id, error }),
  );
  return { error: null, done: true };
}
