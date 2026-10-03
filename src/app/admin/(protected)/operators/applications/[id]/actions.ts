'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/db';
import { isUuid } from '@/lib/validation';
import { eq } from 'drizzle-orm';
import { operatorApplications } from '@/db/schema';
import { requireAdmin } from '@/modules/auth/guard';
import { sendApplicationRejectedMail } from '@/modules/notification/send-account-mails';
import { sendQuietly } from '@/modules/notification/send-quietly';
import { sendAccountInvite } from '@/modules/partner/account-invite';
import { createOperatorAccount } from '@/modules/partner/accounts';
import { approveApplication, reviewApplication } from '@/modules/partner/applications';
import { createLoginUser } from '@/modules/partner/auth-user';

const schema = z.object({
  decision: z.enum(['approve', 'reviewing', 'rejected']),
  slug: z.string().trim().max(60),
  note: z.string().trim().max(1000),
});

/**
 * 登録申請を承認する（事業者として登録し、申請の担当者のアカウントを作って招待のメールを送る）・確認中にする・
 * 見送る（申請者に結果をメールで知らせる）。招待のリンクは URL に載せない（アクセスの記録に残さないため）
 */
export async function reviewApplicationAction(applicationId: string, formData: FormData) {
  const admin = await requireAdmin();
  if (!isUuid(applicationId)) redirect('/admin/operators/applications');
  const detail = `/admin/operators/applications/${applicationId}`;
  const parsed = schema.safeParse({
    decision: formData.get('decision'),
    slug: formData.get('slug') ?? '',
    note: formData.get('note') ?? '',
  });
  if (!parsed.success) redirect(`${detail}?error=input`);
  const now = new Date();
  if (parsed.data.decision === 'approve') {
    if (parsed.data.slug && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(parsed.data.slug)) redirect(`${detail}?error=slug_format`);
    const result = await approveApplication(db, {
      shopId: admin.shopId,
      applicationId,
      slug: parsed.data.slug || undefined,
      note: parsed.data.note,
      actorId: admin.userId,
      now,
    });
    if (!result.ok) redirect(`${detail}?error=${result.error}`);
    const [app] = await db
      .select({ email: operatorApplications.email, contactName: operatorApplications.contactName })
      .from(operatorApplications)
      .where(eq(operatorApplications.id, applicationId));
    const account = await createOperatorAccount(db, createLoginUser, {
      shopId: admin.shopId,
      operatorId: result.operatorId,
      email: app.email,
      name: app.contactName,
      actorId: admin.userId,
    });
    const invite = account.ok
      ? (
          await sendAccountInvite(db, {
            shopId: admin.shopId,
            email: account.email,
            name: app.contactName,
            operatorName: account.operatorName,
            kind: 'application',
          })
        ).status
      : 'taken';
    revalidatePath('/admin', 'layout');
    redirect(`/admin/operators/${result.operatorId}?saved=approved&invite=${invite === 'sent' ? 'sent' : invite}`);
  }
  const ok = await reviewApplication(db, {
    shopId: admin.shopId,
    applicationId,
    status: parsed.data.decision,
    note: parsed.data.note,
    actorId: admin.userId,
    now,
  });
  // 見送ったら、申請者に結果をメールで知らせる（組合のメモは載せない）
  let mail = '';
  if (ok && parsed.data.decision === 'rejected') {
    const [app] = await db
      .select({
        email: operatorApplications.email,
        contactName: operatorApplications.contactName,
        companyName: operatorApplications.companyName,
      })
      .from(operatorApplications)
      .where(eq(operatorApplications.id, applicationId));
    const sent = await sendQuietly('mail.application_result.failed', { applicationId }, (mailer) =>
      sendApplicationRejectedMail(db, mailer, {
        shopId: admin.shopId,
        to: app.email,
        name: app.contactName,
        companyName: app.companyName,
      }),
    );
    mail = `&mail=${sent.status === 'sent' ? 'sent' : 'failed'}`;
  }
  revalidatePath('/admin', 'layout');
  redirect(`${detail}?${ok ? `saved=${parsed.data.decision}${mail}` : 'error=ALREADY_DONE'}`);
}
