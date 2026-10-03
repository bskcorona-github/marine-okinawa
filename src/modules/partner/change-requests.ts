import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { invoiceNumberSchema } from '@/lib/invoice';
import type { Db, DbOrTx } from '@/db/client';
import { operatorChangeRequests, operators } from '@/db/schema';
import { logWarn } from '@/lib/log';
import { changedFields } from '@/modules/audit/diff';
import { writeAuditLog } from '@/modules/audit/log';

/** 事業者が更新を申請できる項目（画面の表示名つき）。組合の内部メモ（operators.about）は含めない */
export const PROFILE_FIELDS = {
  name: '事業者名',
  address: '所在地',
  representative: '代表者',
  contactName: '担当者',
  email: '連絡用メールアドレス',
  phone: '当日の連絡先（電話）',
  contactHours: '電話の受付時間',
  emergencyPhone: '緊急連絡先',
  invoiceNumber: 'インボイスの登録番号',
  bankAccount: '精算口座',
} as const;

export type ProfileField = keyof typeof PROFILE_FIELDS;

export const profileSchema = z.object({
  name: z.string().trim().min(1).max(100),
  address: z.string().trim().max(200),
  representative: z.string().trim().max(60),
  contactName: z.string().trim().max(60),
  email: z
    .string()
    .trim()
    .max(254)
    .pipe(z.union([z.literal(''), z.email()])),
  phone: z.string().trim().max(30),
  contactHours: z.string().trim().max(100),
  emergencyPhone: z.string().trim().max(30),
  invoiceNumber: invoiceNumberSchema,
  bankAccount: z.string().trim().max(300),
});

export type OperatorProfile = z.infer<typeof profileSchema>;

/**
 * 変わると、お金の振込先・連絡の宛先・本人に確かめる電話番号が変わる項目（なりすましで書き換えられないよう、
 * 反映の前に登録済みの電話番号へ折り返して本人に確かめてもらう。電話番号も含めるのは、先に番号だけ書き換えてから
 * 口座を変える申請を出され、折り返しの電話がなりすましの人につながるのを防ぐため）
 */
export const SENSITIVE_PROFILE_FIELDS = [
  'bankAccount',
  'email',
  'phone',
  'emergencyPhone',
] as const satisfies readonly ProfileField[];

/** 更新申請のうち、今の登録内容から実際に変わる「慎重に扱う項目」（口座・連絡用メールアドレス・電話番号） */
export function sensitiveChanges(
  payload: Partial<Record<ProfileField, unknown>>,
  current: Partial<Record<ProfileField, unknown>>,
): ProfileField[] {
  return SENSITIVE_PROFILE_FIELDS.filter(
    (field) => field in payload && String(payload[field] ?? '').trim() !== String(current[field] ?? '').trim(),
  );
}

/** 今の登録内容（事業者画面の更新申請の初期値） */
export async function getOperatorProfile(db: DbOrTx, operatorId: string): Promise<OperatorProfile | null> {
  const [row] = await db.select().from(operators).where(eq(operators.id, operatorId));
  if (!row) return null;
  return Object.fromEntries((Object.keys(PROFILE_FIELDS) as ProfileField[]).map((k) => [k, row[k]])) as OperatorProfile;
}

/**
 * 登録情報の更新を申請する（変えた項目だけを残す）。変わった項目がなければ申請しない。
 * すでに確認待ちの申請があれば、新しい内容で置き換える
 */
export async function submitChangeRequest(
  db: Db,
  input: { shopId: string; operatorId: string; profile: OperatorProfile; note: string; actorId: string | null },
): Promise<{ ok: true; requestId: string } | { ok: false; error: 'NO_CHANGES' | 'NOT_FOUND' }> {
  const current = await getOperatorProfile(db, input.operatorId);
  if (!current) return { ok: false, error: 'NOT_FOUND' };
  const payload = Object.fromEntries(
    (Object.keys(PROFILE_FIELDS) as ProfileField[])
      .filter((k) => input.profile[k] !== current[k])
      .map((k) => [k, input.profile[k]]),
  );
  if (Object.keys(payload).length === 0) return { ok: false, error: 'NO_CHANGES' };
  return db.transaction(async (tx) => {
    await tx
      .update(operatorChangeRequests)
      .set({ status: 'rejected', reviewNote: '新しい申請に置き換え' })
      .where(
        and(eq(operatorChangeRequests.operatorId, input.operatorId), eq(operatorChangeRequests.status, 'pending')),
      );
    const [row] = await tx
      .insert(operatorChangeRequests)
      .values({
        shopId: input.shopId,
        operatorId: input.operatorId,
        payload,
        note: input.note.trim(),
        requestedBy: input.actorId,
      })
      .returning({ id: operatorChangeRequests.id });
    await writeAuditLog(tx, {
      shopId: input.shopId,
      actorId: input.actorId,
      action: 'operator.change_request',
      targetType: 'operator',
      targetId: input.operatorId,
      ...changedFields(Object.fromEntries(Object.keys(payload).map((k) => [k, current[k as ProfileField]])), payload, {
        masked: ['bankAccount'],
      }),
    });
    return { ok: true, requestId: row.id } as const;
  });
}

export async function listChangeRequests(
  db: DbOrTx,
  params: { shopId: string; operatorId?: string; status?: 'pending' | 'approved' | 'rejected' },
) {
  return db
    .select({
      id: operatorChangeRequests.id,
      operatorId: operatorChangeRequests.operatorId,
      operatorName: operators.name,
      payload: operatorChangeRequests.payload,
      note: operatorChangeRequests.note,
      status: operatorChangeRequests.status,
      reviewNote: operatorChangeRequests.reviewNote,
      createdAt: operatorChangeRequests.createdAt,
      reviewedAt: operatorChangeRequests.reviewedAt,
    })
    .from(operatorChangeRequests)
    .innerJoin(operators, eq(operators.id, operatorChangeRequests.operatorId))
    .where(
      and(
        eq(operatorChangeRequests.shopId, params.shopId),
        params.operatorId ? eq(operatorChangeRequests.operatorId, params.operatorId) : undefined,
        params.status ? eq(operatorChangeRequests.status, params.status) : undefined,
      ),
    )
    .orderBy(desc(operatorChangeRequests.createdAt))
    .limit(50);
}

/**
 * 更新申請を承認して事業者の情報に反映する、または見送る（確認待ちの申請だけ）。反映したときは、変わった項目の前後を
 * 履歴に残す（口座は値を残さない）。done：反映・見送り済み、invalid：申請の内容が今の入力の決まりに合わない
 */
export async function reviewChangeRequest(
  db: Db,
  input: {
    shopId: string;
    /** 申請を出した事業者（画面で開いている事業者の申請だけを扱う） */
    operatorId: string;
    requestId: string;
    approve: boolean;
    /** 登録済みの電話番号へ折り返して本人に確かめた（慎重に扱う項目が変わる申請の反映に必須） */
    verifiedByPhone: boolean;
    note: string;
    actorId: string | null;
    now: Date;
  },
): Promise<'ok' | 'done' | 'invalid' | 'unverified'> {
  return db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(operatorChangeRequests)
      .where(
        and(
          eq(operatorChangeRequests.id, input.requestId),
          eq(operatorChangeRequests.shopId, input.shopId),
          eq(operatorChangeRequests.operatorId, input.operatorId),
          eq(operatorChangeRequests.status, 'pending'),
        ),
      )
      .for('update');
    if (!request) return 'done';
    let diff: ReturnType<typeof changedFields> = { before: null, after: {} };
    if (input.approve) {
      // 申請の内容をもう一度検証してから反映する（申請の後で入力の条件を変えても、壊れた値を入れない）
      const [current] = await tx.select().from(operators).where(eq(operators.id, request.operatorId)).for('update');
      const before = Object.fromEntries((Object.keys(PROFILE_FIELDS) as ProfileField[]).map((k) => [k, current[k]]));
      // 口座・メール・電話番号が変わるときは、折り返して確かめた印がないと反映しない（行をロックした今の値で判定する）
      if (sensitiveChanges(request.payload, before).length > 0 && !input.verifiedByPhone) return 'unverified';
      const merged = profileSchema.safeParse({ ...before, ...request.payload });
      if (!merged.success) {
        logWarn('operator.change_request.invalid', { requestId: request.id, operatorId: request.operatorId });
        return 'invalid';
      }
      await tx.update(operators).set(merged.data).where(eq(operators.id, request.operatorId));
      diff = changedFields(before, merged.data, { masked: ['bankAccount'] });
    }
    await tx
      .update(operatorChangeRequests)
      .set({
        status: input.approve ? 'approved' : 'rejected',
        reviewNote: input.note.trim(),
        reviewedBy: input.actorId,
        reviewedAt: input.now,
      })
      .where(eq(operatorChangeRequests.id, request.id));
    await writeAuditLog(tx, {
      shopId: input.shopId,
      actorId: input.actorId,
      action: input.approve ? 'operator.change_approve' : 'operator.change_reject',
      targetType: 'operator',
      targetId: request.operatorId,
      before: diff.before,
      // 見送りは、申請された項目の名前だけ（口座などの値は残さない）
      after: input.approve
        ? { requestId: request.id, ...diff.after }
        : { requestId: request.id, fields: Object.keys(request.payload as Record<string, unknown>) },
    });
    return 'ok';
  });
}
