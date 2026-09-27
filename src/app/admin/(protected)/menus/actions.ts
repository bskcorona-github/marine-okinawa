'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/db';
import { requireAdmin } from '@/modules/auth/guard';
import { writeAuditLog } from '@/modules/audit/log';
import { createMenu, menuInputSchema, updateMenu } from '@/modules/catalog/menu-admin';

export type MenuFormState = { error: string | null };

const ERROR_LABELS = {
  SLUG_TAKEN: 'この URL 名（slug）は既に使われています',
  NOT_FOUND: 'メニューが見つかりません',
  OPERATOR_NOT_FOUND: '提供事業者が見つかりません',
} as const;

function parseForm(formData: FormData) {
  const raw = Object.fromEntries(formData) as Record<string, string>;
  let prices: unknown = [];
  try {
    prices = JSON.parse(raw.prices ?? '[]');
  } catch {
    prices = [];
  }
  const images = (raw.images ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return menuInputSchema.safeParse({
    ...raw,
    minAge: raw.minAge ? raw.minAge : null,
    cutoffPrevDayTime: raw.cutoffPrevDayTime ? raw.cutoffPrevDayTime : null,
    operatorId: raw.operatorId ? raw.operatorId : null,
    images,
    prices,
  });
}

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  return `入力内容を確認してください（${issue.path.join('.') || '入力'}：${issue.message}）`;
}

export async function createMenuAction(_prev: MenuFormState, formData: FormData): Promise<MenuFormState> {
  const admin = await requireAdmin();
  const parsed = parseForm(formData);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const result = await createMenu(db, admin.shopId, parsed.data);
  if (!result.ok) return { error: ERROR_LABELS[result.error] };
  await writeAuditLog(db, {
    shopId: admin.shopId,
    actorId: admin.userId,
    action: 'menu.create',
    targetType: 'menu',
    targetId: result.menuId,
    after: parsed.data,
  });
  revalidatePath('/', 'layout');
  redirect(`/admin/menus/${result.menuId}/schedule?created=1`);
}

export async function updateMenuAction(
  menuId: string,
  _prev: MenuFormState,
  formData: FormData,
): Promise<MenuFormState> {
  const admin = await requireAdmin();
  const parsed = parseForm(formData);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const result = await updateMenu(db, admin.shopId, menuId, parsed.data);
  if (!result.ok) return { error: ERROR_LABELS[result.error] };
  await writeAuditLog(db, {
    shopId: admin.shopId,
    actorId: admin.userId,
    action: 'menu.update',
    targetType: 'menu',
    targetId: menuId,
    after: parsed.data,
  });
  revalidatePath('/', 'layout');
  redirect(`/admin/menus/${menuId}?saved=1`);
}
