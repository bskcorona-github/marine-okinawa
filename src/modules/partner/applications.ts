import { randomUUID } from 'node:crypto';
import { and, desc, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { invoiceNumberSchema } from '@/lib/invoice';
import type { Db, DbOrTx } from '@/db/client';
import { applicationStatus, operatorApplications, operatorDocuments, operators } from '@/db/schema';
import { writeAuditLog } from '@/modules/audit/log';
import { normalizeEmail } from '@/modules/customer/normalize';

export type ApplicationStatus = (typeof applicationStatus.enumValues)[number];

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  new: '未確認',
  reviewing: '確認中',
  approved: '登録済み',
  rejected: '見送り',
};

export const applicationInputSchema = z.object({
  companyName: z.string().trim().min(1).max(100),
  address: z.string().trim().max(200),
  representative: z.string().trim().max(60),
  contactName: z.string().trim().min(1).max(60),
  phone: z.string().trim().min(1).max(30),
  email: z.email().max(254),
  emergencyPhone: z.string().trim().max(30),
  invoiceNumber: invoiceNumberSchema,
  planInfo: z.string().trim().min(1).max(5000),
  message: z.string().trim().max(2000),
});

export type ApplicationInput = z.infer<typeof applicationInputSchema>;

/** 登録申請を保存する（公開フォームから。プライバシーポリシーへの同意日時つき） */
export async function createApplication(
  db: DbOrTx,
  params: { shopId: string; input: ApplicationInput; now: Date },
): Promise<{ id: string }> {
  const [row] = await db
    .insert(operatorApplications)
    .values({
      shopId: params.shopId,
      ...params.input,
      email: normalizeEmail(params.input.email) ?? params.input.email,
      consentedAt: params.now,
    })
    .returning({ id: operatorApplications.id });
  return row;
}

export async function listApplications(db: DbOrTx, params: { shopId: string; status?: ApplicationStatus | null }) {
  return db
    .select()
    .from(operatorApplications)
    .where(
      and(
        eq(operatorApplications.shopId, params.shopId),
        params.status ? eq(operatorApplications.status, params.status) : undefined,
      ),
    )
    .orderBy(desc(operatorApplications.createdAt))
    .limit(200);
}

export async function getApplication(db: DbOrTx, params: { shopId: string; applicationId: string }) {
  const [row] = await db
    .select()
    .from(operatorApplications)
    .where(and(eq(operatorApplications.shopId, params.shopId), eq(operatorApplications.id, params.applicationId)));
  return row ?? null;
}

/** 確認中・見送りにする（メモつき） */
export async function reviewApplication(
  db: DbOrTx,
  params: {
    shopId: string;
    applicationId: string;
    status: 'reviewing' | 'rejected';
    note: string;
    actorId: string | null;
    now: Date;
  },
): Promise<boolean> {
  const [row] = await db
    .update(operatorApplications)
    .set({ status: params.status, reviewNote: params.note.trim(), reviewedBy: params.actorId, reviewedAt: params.now })
    .where(
      and(
        eq(operatorApplications.shopId, params.shopId),
        eq(operatorApplications.id, params.applicationId),
        // 登録済みの申請は戻さない
        ne(operatorApplications.status, 'approved'),
      ),
    )
    .returning({ status: operatorApplications.status });
  if (!row) return false;
  await writeAuditLog(db, {
    shopId: params.shopId,
    actorId: params.actorId,
    action: 'operator_application.review',
    targetType: 'operator_application',
    targetId: params.applicationId,
    after: { status: params.status, note: params.note },
  });
  return true;
}

/** slug を事業者名から作れないときの代わり（英数字の短い ID） */
const fallbackSlug = () => `operator-${randomUUID().slice(0, 8)}`;

/**
 * 登録申請を承認し、事業者として登録する（申請の内容を事業者の情報へ写し、添付の資料を事業者の資料にする）。
 * 承認済み・見送りの申請は承認できない
 */
export async function approveApplication(
  db: Db,
  params: { shopId: string; applicationId: string; slug?: string; note: string; actorId: string | null; now: Date },
): Promise<{ ok: true; operatorId: string } | { ok: false; error: 'NOT_FOUND' | 'ALREADY_DONE' | 'SLUG_TAKEN' }> {
  return db.transaction(async (tx) => {
    const [app] = await tx
      .select()
      .from(operatorApplications)
      .where(and(eq(operatorApplications.shopId, params.shopId), eq(operatorApplications.id, params.applicationId)))
      .for('update');
    if (!app) return { ok: false, error: 'NOT_FOUND' } as const;
    if (app.status === 'approved' || app.status === 'rejected') return { ok: false, error: 'ALREADY_DONE' } as const;
    const slug = params.slug && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(params.slug) ? params.slug : fallbackSlug();
    const [taken] = await tx
      .select({ id: operators.id })
      .from(operators)
      .where(and(eq(operators.shopId, params.shopId), eq(operators.slug, slug)));
    if (taken) return { ok: false, error: 'SLUG_TAKEN' } as const;
    const [operator] = await tx
      .insert(operators)
      .values({
        shopId: params.shopId,
        slug,
        name: app.companyName,
        email: app.email,
        phone: app.phone,
        address: app.address,
        representative: app.representative,
        contactName: app.contactName,
        emergencyPhone: app.emergencyPhone,
        invoiceNumber: app.invoiceNumber,
      })
      .returning({ id: operators.id });
    await tx
      .update(operatorDocuments)
      .set({ operatorId: operator.id })
      .where(eq(operatorDocuments.applicationId, app.id));
    await tx
      .update(operatorApplications)
      .set({
        status: 'approved',
        operatorId: operator.id,
        reviewNote: params.note.trim(),
        reviewedBy: params.actorId,
        reviewedAt: params.now,
      })
      .where(eq(operatorApplications.id, app.id));
    await writeAuditLog(tx, {
      shopId: params.shopId,
      actorId: params.actorId,
      action: 'operator_application.approve',
      targetType: 'operator_application',
      targetId: app.id,
      after: { operatorId: operator.id, slug },
    });
    return { ok: true, operatorId: operator.id } as const;
  });
}
