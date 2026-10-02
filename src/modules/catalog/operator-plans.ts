import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import type { Db, DbOrTx } from '@/db/client';
import { activities, menuRevisions, menus, menuTranslations, operators, scheduleRules } from '@/db/schema';
import { formatYen } from '@/lib/format';
import { changedFields } from '@/modules/audit/diff';
import { writeAuditLog } from '@/modules/audit/log';
import {
  createMenu,
  menuInputSchema,
  unitChangeBlocked,
  updateMenu,
  type MenuInput,
  type MenuSaveResult,
} from './menu-admin';
import { MENU_FIELD_LABELS } from './menu-form-data';
import { DEFAULT_LOCALE, getMenuForAdmin, type AdminMenu } from './menus';
import { isPerPerson } from '@/modules/catalog/capacity-unit';
import { SEASON_LABELS } from './season';

/** 事業者のプランの操作で止める理由 */
export type PlanErrorCode =
  | 'NOT_FOUND'
  | 'LOCKED'
  | 'NOT_DRAFT'
  | 'NOT_PUBLISHED'
  /** 組合が止めた受付は、事業者からは再開できない */
  | 'PAUSED_BY_STAFF'
  | 'ALREADY_PENDING'
  | 'NO_PENDING'
  | 'NO_SCHEDULE'
  | 'NOTE_REQUIRED'
  /** 審査の画面を開いたあとに、事業者が申請の内容を直した（見ていない内容を承認しないように） */
  | 'CHANGED_SINCE_VIEW'
  /** 申請のあとに組合が同じ項目を直していて、どちらを残すか決められない */
  | 'REVISION_CONFLICT'
  /** 申請の内容が今の入力の決まりに合わない */
  | 'INVALID_REVISION'
  /** 事業者がフォームを開いたあとに、組合がプランを直した（そのまま申請すると組合の修正が巻き戻る） */
  | 'PLAN_CHANGED'
  | Exclude<MenuSaveResult, { ok: true }>['error'];

export class PlanError extends Error {
  constructor(readonly code: PlanErrorCode) {
    super(code);
    this.name = 'PlanError';
  }
}

export const PLAN_ERROR_LABELS: Record<PlanErrorCode, string> = {
  NOT_FOUND: 'プランが見つかりません。',
  LOCKED: 'このプランは掲載を終えているため、変えられません。組合へご連絡ください。',
  NOT_DRAFT: '公開の申請は、まだ公開していないプランだけできます。',
  NOT_PUBLISHED: '公開中・受付停止中のプランだけ、受付を止めたり再開したりできます。',
  PAUSED_BY_STAFF: '組合が受付を止めているプランです。再開するときは、組合へご連絡ください。',
  ALREADY_PENDING: 'すでに申請しています。組合の確認をお待ちください。',
  NO_PENDING: '審査中の申請がありません（取り下げられたか、すでに審査が済んでいます）。',
  NO_SCHEDULE: '開催時間を 1 つ以上登録してから申請してください（「開催時間・空き枠」で登録できます）。',
  NOTE_REQUIRED: '差し戻すときは、理由を入れてください。',
  CHANGED_SINCE_VIEW:
    '審査の画面を開いたあとに、事業者が内容を直しました。画面を開き直して、もう一度確かめてください。',
  REVISION_CONFLICT:
    '申請のあとに組合が同じ項目を直したため、このままでは承認できません。差し戻して、事業者にもう一度申請してもらってください。',
  INVALID_REVISION:
    '申請の内容に、今の入力の決まりに合わない項目があります。差し戻して、事業者に直してもらってください。',
  PLAN_CHANGED:
    'フォームを開いたあとに、組合がこのプランを直しました。画面を開き直して、今の内容を確かめてから直してください（入力した内容は保存していません）。',
  SLUG_TAKEN: 'この URL 名は既に使われています。',
  OPERATOR_NOT_FOUND: '事業者が見つかりません。',
  ACTIVITY_NOT_FOUND: 'アクティビティが見つかりません。',
  UNIT_LOCKED: '予約のあるプランは、定員の単位（名／艇）を変えられません。',
};

/** プランの今の内容を、編集フォームと同じ形（MenuInput）にする（変更の申請との差分・フォームの初期値に使う） */
export function menuToInput(menu: AdminMenu): MenuInput {
  return {
    slug: menu.slug,
    status: menu.status,
    category: menu.category,
    durationMin: menu.durationMin,
    minAge: menu.minAge,
    maxPartySize: menu.maxPartySize,
    minPartySize: menu.minPartySize,
    bookingCutoffMin: menu.bookingCutoffMin,
    cutoffPrevDayTime: menu.cutoffPrevDayTime ? menu.cutoffPrevDayTime.slice(0, 5) : null,
    operatorId: menu.operatorId,
    activityId: menu.activityId,
    featured: menu.featured,
    requireAges: menu.requireAges,
    meetingMapUrl: menu.meetingMapUrl,
    capacityUnit: !isPerPerson(menu.capacityUnit) ? '艇' : '名',
    title: menu.translation.title,
    description: menu.translation.description,
    meetingPoint: menu.translation.meetingPoint,
    meetingAddress: menu.translation.meetingAddress,
    whatToBring: menu.translation.whatToBring,
    summary: menu.translation.summary,
    included: menu.translation.included,
    conditions: menu.translation.conditions,
    notes: menu.translation.notes,
    cancellationPolicy: menu.translation.cancellationPolicy,
    weatherPolicy: menu.translation.weatherPolicy,
    images: menu.images.map((i) => i.url),
    prices: menu.prices.map((p) => ({
      id: p.id,
      label: p.label,
      price: p.price,
      season: p.season,
      meetingPoint: p.meetingPoint,
    })),
    includedGuests: menu.includedGuests,
    extraGuestPrice: menu.extraGuestPrice,
    maxGuests: menu.maxGuests,
  } as MenuInput;
}

/** 自社が掲載元のプランか（事業者画面の操作の前に確かめる。中身は読まない） */
export async function isOperatorPlan(
  db: DbOrTx,
  params: { shopId: string; operatorId: string; menuId: string },
): Promise<boolean> {
  const [row] = await db
    .select({ id: menus.id })
    .from(menus)
    .where(and(eq(menus.id, params.menuId), eq(menus.shopId, params.shopId), eq(menus.operatorId, params.operatorId)));
  return Boolean(row);
}

/** 事業者のプランを取り出す（自社が掲載元のプランだけ。ほかは null） */
async function ownedMenu(db: DbOrTx, params: { shopId: string; operatorId: string; menuId: string }) {
  const menu = await getMenuForAdmin(db, params.shopId, params.menuId);
  return menu && menu.operatorId === params.operatorId ? menu : null;
}

/** 審査中の変更の申請（なければ null） */
export async function getPendingRevision(db: DbOrTx, menuId: string) {
  const [row] = await db
    .select()
    .from(menuRevisions)
    .where(and(eq(menuRevisions.menuId, menuId), eq(menuRevisions.status, 'pending')));
  return row ?? null;
}

/** 直近の差し戻し（事業者に理由を見せるため。承認・取り下げのあとは出さない） */
async function latestRejectedRevision(db: DbOrTx, menuId: string) {
  const [row] = await db
    .select()
    .from(menuRevisions)
    .where(eq(menuRevisions.menuId, menuId))
    .orderBy(desc(menuRevisions.createdAt))
    .limit(1);
  return row?.status === 'rejected' ? row : null;
}

/** 事業者画面のプランの一覧（自社が掲載元のものだけ） */
export async function listOperatorPlans(db: DbOrTx, params: { shopId: string; operatorId: string }) {
  return (
    db
      .select({
        id: menus.id,
        slug: menus.slug,
        status: menus.status,
        reviewStatus: menus.reviewStatus,
        reviewNote: menus.reviewNote,
        capacityUnit: menus.capacityUnit,
        updatedAt: menus.updatedAt,
        title: menuTranslations.title,
        activityName: activities.name,
        pendingRevision: sql<boolean>`exists (select 1 from ${menuRevisions} r where r.menu_id = "menus"."id" and r.status = 'pending')`,
        hasSchedule: sql<boolean>`exists (select 1 from ${scheduleRules} sr where sr.menu_id = "menus"."id")`,
      })
      .from(menus)
      .innerJoin(
        menuTranslations,
        and(eq(menuTranslations.menuId, menus.id), eq(menuTranslations.locale, DEFAULT_LOCALE)),
      )
      .leftJoin(activities, eq(activities.id, menus.activityId))
      .where(and(eq(menus.shopId, params.shopId), eq(menus.operatorId, params.operatorId)))
      // 掲載を終えたプランは最後に（今使っているプランを先に）
      .orderBy(sql`case when ${menus.status} = 'archived' then 1 else 0 end`, asc(menus.createdAt))
  );
}

/** 事業者画面のプランの詳細：今の内容と、審査中の変更の申請・直近の差し戻し */
export async function getOperatorPlan(db: DbOrTx, params: { shopId: string; operatorId: string; menuId: string }) {
  const menu = await ownedMenu(db, params);
  if (!menu) return null;
  const [pendingRevision, rejectedRevision, [rule]] = await Promise.all([
    getPendingRevision(db, menu.id),
    latestRejectedRevision(db, menu.id),
    db.select({ id: scheduleRules.id }).from(scheduleRules).where(eq(scheduleRules.menuId, menu.id)).limit(1),
  ]);
  return { menu, pendingRevision, rejectedRevision, hasSchedule: Boolean(rule) };
}

/** 事業者が新しく作るプランの URL 名（事業者の slug ＋ 乱数。あとで組合が変えられる） */
function newPlanSlug(operatorSlug: string) {
  return `${operatorSlug}-${randomBytes(3).toString('hex')}`.slice(0, 80);
}

/** 事業者が新しいプランを作る（下書き。掲載元は自社、URL 名は自動） */
export async function createOperatorPlan(
  db: Db,
  params: { shopId: string; operatorId: string; actorId: string | null; input: MenuInput },
): Promise<string> {
  // 変更と履歴は 1 つのトランザクションで（片方だけ残らないように）
  return db.transaction(async (tx) => {
    const [operator] = await tx
      .select({ slug: operators.slug, status: operators.status })
      .from(operators)
      .where(and(eq(operators.id, params.operatorId), eq(operators.shopId, params.shopId)));
    if (!operator || operator.status === 'suspended') throw new PlanError('OPERATOR_NOT_FOUND');
    // URL 名がたまたま重なったときは作り直す
    for (let attempt = 0; attempt < 3; attempt++) {
      const input: MenuInput = {
        ...params.input,
        slug: newPlanSlug(operator.slug),
        status: 'draft',
        operatorId: params.operatorId,
        featured: false,
      };
      const result = await createMenu(tx, params.shopId, input);
      if (result.ok) {
        await writeAuditLog(tx, {
          shopId: params.shopId,
          actorId: params.actorId,
          action: 'menu.create',
          targetType: 'menu',
          targetId: result.menuId,
          after: { ...input, via: 'operator' },
        });
        return result.menuId;
      }
      if (result.error !== 'SLUG_TAKEN') throw new PlanError(result.error);
    }
    throw new PlanError('SLUG_TAKEN');
  });
}

/**
 * 事業者がプランを保存する。下書き（まだ公開していない）はすぐ反映する。公開中・受付停止中は、内容の変更を申請として保存し、
 * 組合が承認するまで今の内容のまま公開する（申請中にもう一度保存すると、申請を置き換える）
 */
export async function saveOperatorPlan(
  db: Db,
  params: {
    shopId: string;
    operatorId: string;
    menuId: string;
    actorId: string | null;
    input: MenuInput;
    note?: string;
    /** フォームを開いたときのプランの更新日時（公開中の変更の申請で、そのあとに組合が直していないかを確かめる） */
    seenUpdatedAt?: Date | null;
  },
): Promise<{ applied: 'saved' | 'requested' }> {
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: menus.id })
      .from(menus)
      .where(and(eq(menus.id, params.menuId), eq(menus.shopId, params.shopId)))
      .for('update');
    if (!locked) throw new PlanError('NOT_FOUND');
    const menu = await ownedMenu(tx, params);
    if (!menu) throw new PlanError('NOT_FOUND');
    if (menu.status === 'archived') throw new PlanError('LOCKED');
    // フォームでは変えさせない値は、今のプランの値にそろえる
    const input: MenuInput = {
      ...params.input,
      slug: menu.slug,
      status: menu.status,
      operatorId: params.operatorId,
      featured: menu.featured,
    };
    if (menu.status === 'draft') {
      const result = await updateMenu(tx, params.shopId, menu.id, input);
      if (!result.ok) throw new PlanError(result.error);
      const diff = changedFields(menuToInput(menu), input);
      await writeAuditLog(tx, {
        shopId: params.shopId,
        actorId: params.actorId,
        action: 'menu.update',
        targetType: 'menu',
        targetId: menu.id,
        before: diff.before,
        after: { ...diff.after, via: 'operator' },
      });
      return { applied: 'saved' as const };
    }
    // 公開中の変更は、承認のときに保存できないと分かる内容（別ショップのアクティビティ・予約のあるプランの単位の変更）を先に止める
    if (input.activityId) {
      const [activity] = await tx
        .select({ id: activities.id })
        .from(activities)
        .where(and(eq(activities.id, input.activityId), eq(activities.shopId, params.shopId)));
      if (!activity) throw new PlanError('ACTIVITY_NOT_FOUND');
    }
    if (await unitChangeBlocked(tx, menu.id, menu.capacityUnit, input.capacityUnit)) throw new PlanError('UNIT_LOCKED');
    const note = params.note?.trim() ?? '';
    const pending = await getPendingRevision(tx, menu.id);
    // 新しく申請するときは、申請のもとにする内容が、事業者がフォームで見ていた内容と同じであること
    if (!pending && params.seenUpdatedAt && menu.updatedAt.getTime() !== params.seenUpdatedAt.getTime()) {
      throw new PlanError('PLAN_CHANGED');
    }
    if (pending) {
      await tx
        .update(menuRevisions)
        .set({ data: input as Record<string, unknown>, note, requestedBy: params.actorId, updatedAt: sql`now()` })
        .where(eq(menuRevisions.id, pending.id));
    } else {
      // 申請のもとにした内容を残す（審査中にもう一度保存しても、もとは最初の申請のときのまま）
      await tx.insert(menuRevisions).values({
        menuId: menu.id,
        operatorId: params.operatorId,
        data: input as Record<string, unknown>,
        baseData: menuToInput(menu) as Record<string, unknown>,
        note,
        requestedBy: params.actorId,
      });
    }
    await writeAuditLog(tx, {
      shopId: params.shopId,
      actorId: params.actorId,
      action: 'menu.revision_request',
      targetType: 'menu',
      targetId: menu.id,
      after: { note },
    });
    return { applied: 'requested' as const };
  });
}

/** 事業者が変更の申請を取り下げる */
export async function withdrawPlanRevision(
  db: Db,
  params: { shopId: string; operatorId: string; menuId: string; actorId: string | null },
): Promise<void> {
  // 変更と履歴は 1 つのトランザクションで（片方だけ残らないように）
  return db.transaction(async (tx) => {
    const menu = await ownedMenu(tx, params);
    if (!menu) throw new PlanError('NOT_FOUND');
    const rows = await tx
      .update(menuRevisions)
      .set({ status: 'withdrawn', updatedAt: sql`now()` })
      .where(and(eq(menuRevisions.menuId, menu.id), eq(menuRevisions.status, 'pending')))
      .returning({ id: menuRevisions.id });
    if (rows.length === 0) throw new PlanError('NO_PENDING');
    await writeAuditLog(tx, {
      shopId: params.shopId,
      actorId: params.actorId,
      action: 'menu.revision_withdraw',
      targetType: 'menu',
      targetId: menu.id,
    });
  });
}

/** 事業者が公開を申請する（下書きのプランだけ。開催時間が 1 つ以上あること） */
export async function requestPlanPublish(
  db: Db,
  params: { shopId: string; operatorId: string; menuId: string; actorId: string | null },
): Promise<void> {
  // 変更と履歴は 1 つのトランザクションで（片方だけ残らないように）
  return db.transaction(async (tx) => {
    const plan = await getOperatorPlan(tx, params);
    if (!plan) throw new PlanError('NOT_FOUND');
    if (plan.menu.status !== 'draft') throw new PlanError('NOT_DRAFT');
    if (plan.menu.reviewStatus === 'pending') throw new PlanError('ALREADY_PENDING');
    if (!plan.hasSchedule) throw new PlanError('NO_SCHEDULE');
    const rows = await tx
      .update(menus)
      .set({ reviewStatus: 'pending', reviewNote: '', reviewRequestedAt: sql`now()` })
      .where(and(eq(menus.id, plan.menu.id), eq(menus.status, 'draft'), ne(menus.reviewStatus, 'pending')))
      .returning({ id: menus.id });
    if (rows.length === 0) throw new PlanError('NOT_DRAFT');
    await writeAuditLog(tx, {
      shopId: params.shopId,
      actorId: params.actorId,
      action: 'menu.publish_request',
      targetType: 'menu',
      targetId: plan.menu.id,
    });
  });
}

/** 事業者が公開の申請を取り下げる（下書きに戻す） */
export async function withdrawPlanPublish(
  db: Db,
  params: { shopId: string; operatorId: string; menuId: string; actorId: string | null },
): Promise<void> {
  // 変更と履歴は 1 つのトランザクションで（片方だけ残らないように）
  return db.transaction(async (tx) => {
    const menu = await ownedMenu(tx, params);
    if (!menu) throw new PlanError('NOT_FOUND');
    const rows = await tx
      .update(menus)
      .set({ reviewStatus: 'none', reviewRequestedAt: null })
      .where(and(eq(menus.id, menu.id), eq(menus.reviewStatus, 'pending')))
      .returning({ id: menus.id });
    if (rows.length === 0) throw new PlanError('NO_PENDING');
    await writeAuditLog(tx, {
      shopId: params.shopId,
      actorId: params.actorId,
      action: 'menu.publish_withdraw',
      targetType: 'menu',
      targetId: menu.id,
    });
  });
}

/** 事業者が受付を一時停止・再開する（公開中・受付停止中のプランだけ。すぐ反映） */
export async function setOperatorPlanPaused(
  db: Db,
  params: { shopId: string; operatorId: string; menuId: string; actorId: string | null; paused: boolean },
): Promise<void> {
  // 変更と履歴は 1 つのトランザクションで（片方だけ残らないように）
  return db.transaction(async (tx) => {
    const menu = await ownedMenu(tx, params);
    if (!menu) throw new PlanError('NOT_FOUND');
    if (menu.status !== 'published' && menu.status !== 'paused') throw new PlanError('NOT_PUBLISHED');
    const status = params.paused ? 'paused' : 'published';
    if (menu.status === status) return;
    if (!params.paused && menu.pausedBy !== 'operator') throw new PlanError('PAUSED_BY_STAFF');
    // 読んでから書くまでに組合が状態を変えていたら上書きしない
    const rows = await tx
      .update(menus)
      .set({ status, pausedBy: params.paused ? 'operator' : null })
      .where(and(eq(menus.id, menu.id), eq(menus.status, menu.status)))
      .returning({ id: menus.id });
    if (rows.length === 0) throw new PlanError('PLAN_CHANGED');
    await writeAuditLog(tx, {
      shopId: params.shopId,
      actorId: params.actorId,
      action: 'menu.status',
      targetType: 'menu',
      targetId: menu.id,
      before: { status: menu.status },
      after: { status, via: 'operator' },
    });
  });
}

// ---- 組合の審査 ----

/** 審査待ち（公開の申請・変更の申請）の件数 */
export async function countPendingPlanReviews(db: DbOrTx, shopId: string): Promise<number> {
  const [row] = await db
    .select({
      count: sql<number>`count(*) filter (where ${menus.reviewStatus} = 'pending')
        + count(*) filter (where exists (select 1 from ${menuRevisions} r where r.menu_id = "menus"."id" and r.status = 'pending'))`.mapWith(
        Number,
      ),
    })
    .from(menus)
    .where(eq(menus.shopId, shopId));
  return row?.count ?? 0;
}

/** 組合が公開を承認する（公開の申請中のプランだけ）。掲載元の事業者を返す（結果を知らせるため） */
export async function approvePlanPublish(
  db: Db,
  params: { shopId: string; menuId: string; actorId: string | null; seenUpdatedAt: Date },
): Promise<{ operatorId: string | null }> {
  return db.transaction(async (tx) => {
    const [menu] = await tx
      .select({
        id: menus.id,
        reviewStatus: menus.reviewStatus,
        operatorId: menus.operatorId,
        updatedAt: menus.updatedAt,
      })
      .from(menus)
      .where(and(eq(menus.id, params.menuId), eq(menus.shopId, params.shopId)))
      .for('update');
    if (!menu) throw new PlanError('NOT_FOUND');
    if (menu.reviewStatus !== 'pending') throw new PlanError('NO_PENDING');
    // 審査中も下書きはすぐ直せるので、組合が画面で見た内容のときだけ承認する
    if (menu.updatedAt.getTime() !== params.seenUpdatedAt.getTime()) throw new PlanError('CHANGED_SINCE_VIEW');
    await tx
      .update(menus)
      .set({
        status: 'published',
        publishedAt: sql`coalesce(${menus.publishedAt}, now())`,
        reviewStatus: 'none',
        reviewNote: '',
      })
      .where(eq(menus.id, menu.id));
    await writeAuditLog(tx, {
      shopId: params.shopId,
      actorId: params.actorId,
      action: 'menu.publish_approve',
      targetType: 'menu',
      targetId: menu.id,
    });
    return { operatorId: menu.operatorId };
  });
}

export async function rejectPlanPublish(
  db: Db,
  params: { shopId: string; menuId: string; actorId: string | null; note: string },
): Promise<{ operatorId: string | null }> {
  // 変更と履歴は 1 つのトランザクションで（片方だけ残らないように）
  return db.transaction(async (tx) => {
    const note = params.note.trim();
    if (!note) throw new PlanError('NOTE_REQUIRED');
    const rows = await tx
      .update(menus)
      .set({ reviewStatus: 'rejected', reviewNote: note })
      .where(and(eq(menus.id, params.menuId), eq(menus.shopId, params.shopId), eq(menus.reviewStatus, 'pending')))
      .returning({ id: menus.id, operatorId: menus.operatorId });
    if (rows.length === 0) throw new PlanError('NO_PENDING');
    await writeAuditLog(tx, {
      shopId: params.shopId,
      actorId: params.actorId,
      action: 'menu.publish_reject',
      targetType: 'menu',
      targetId: params.menuId,
      after: { note },
    });
    return { operatorId: rows[0].operatorId };
  });
}

/** 組合が変更の申請を承認し、プランに反映する。公開状態・URL 名・おすすめは今の値のまま */
export async function approvePlanRevision(
  db: Db,
  params: { shopId: string; menuId: string; actorId: string | null; seenRevisionId: string; seenUpdatedAt: Date },
): Promise<{ operatorId: string }> {
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: menus.id })
      .from(menus)
      .where(and(eq(menus.id, params.menuId), eq(menus.shopId, params.shopId)))
      .for('update');
    if (!locked) throw new PlanError('NOT_FOUND');
    const [revision] = await tx
      .select()
      .from(menuRevisions)
      .where(and(eq(menuRevisions.menuId, params.menuId), eq(menuRevisions.status, 'pending')))
      .for('update');
    if (!revision) throw new PlanError('NO_PENDING');
    // 審査中にもう一度保存すると申請が置き換わるので、組合が画面で見た申請のときだけ承認する
    if (revision.id !== params.seenRevisionId || revision.updatedAt.getTime() !== params.seenUpdatedAt.getTime()) {
      throw new PlanError('CHANGED_SINCE_VIEW');
    }
    const menu = (await getMenuForAdmin(tx, params.shopId, params.menuId))!;
    const merged = revision.baseData
      ? mergePlanRevision(revision.baseData as MenuInput, menuToInput(menu), revision.data as MenuInput)
      : { input: revision.data as MenuInput, conflicts: [] };
    if (merged.conflicts.length > 0) throw new PlanError('REVISION_CONFLICT');
    const checked = menuInputSchema.safeParse({
      ...merged.input,
      slug: menu.slug,
      status: menu.status,
      featured: menu.featured,
      operatorId: menu.operatorId,
    });
    if (!checked.success) throw new PlanError('INVALID_REVISION');
    const parsed = checked.data;
    const result = await updateMenu(tx, params.shopId, menu.id, parsed);
    if (!result.ok) throw new PlanError(result.error);
    await tx
      .update(menuRevisions)
      .set({ status: 'approved', reviewedBy: params.actorId, reviewedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(menuRevisions.id, revision.id), eq(menuRevisions.status, 'pending')));
    await writeAuditLog(tx, {
      shopId: params.shopId,
      actorId: params.actorId,
      action: 'menu.revision_approve',
      targetType: 'menu',
      targetId: menu.id,
      ...changedFields(menuToInput(menu), parsed),
    });
    return { operatorId: revision.operatorId };
  });
}

/** 組合が変更の申請を差し戻す（理由は必須） */
export async function rejectPlanRevision(
  db: Db,
  params: { shopId: string; menuId: string; actorId: string | null; note: string },
): Promise<{ operatorId: string }> {
  // 変更と履歴は 1 つのトランザクションで（片方だけ残らないように）
  return db.transaction(async (tx) => {
    const note = params.note.trim();
    if (!note) throw new PlanError('NOTE_REQUIRED');
    const [menu] = await tx
      .select({ id: menus.id })
      .from(menus)
      .where(and(eq(menus.id, params.menuId), eq(menus.shopId, params.shopId)));
    if (!menu) throw new PlanError('NOT_FOUND');
    const rows = await tx
      .update(menuRevisions)
      .set({
        status: 'rejected',
        reviewNote: note,
        reviewedBy: params.actorId,
        reviewedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(menuRevisions.menuId, menu.id), eq(menuRevisions.status, 'pending')))
      .returning({ operatorId: menuRevisions.operatorId });
    if (rows.length === 0) throw new PlanError('NO_PENDING');
    await writeAuditLog(tx, {
      shopId: params.shopId,
      actorId: params.actorId,
      action: 'menu.revision_reject',
      targetType: 'menu',
      targetId: menu.id,
      after: { note },
    });
    return { operatorId: rows[0].operatorId };
  });
}

export type PlanChange = { field: string; label: string; before: string; after: string };

const show = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '（なし）';
  if (typeof value === 'boolean') return value ? 'あり' : 'なし';
  if (Array.isArray(value)) return value.length ? value.join('\n') : '（なし）';
  return String(value);
};

const priceLines = (prices: MenuInput['prices']) =>
  prices
    .map(
      (p) =>
        `${p.label} ${formatYen(p.price)}${p.season ? `（${SEASON_LABELS[p.season === 'on' ? 'on' : 'off']}）` : ''}${p.meetingPoint ? ` 集合：${p.meetingPoint}` : ''}`,
    )
    .join('\n');

/** 組合が決める項目（事業者の申請では変えない） */
const STAFF_FIELDS = new Set<keyof MenuInput>(['slug', 'status', 'featured', 'operatorId']);

/** キーの順によらない JSON（jsonb から読んだ値と、コードで組み立てた値を比べるため） */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

const sameValue = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);

/**
 * 変更の申請を今のプランに重ねる：申請のもとにした内容（base）から事業者が変えた項目だけを、今の内容（current）に反映する。
 * 申請のあとに組合が同じ項目を別の値に直していたら conflicts に入れる（料金区分などの配列は 1 つの項目として比べる）
 */
export function mergePlanRevision(
  base: MenuInput,
  current: MenuInput,
  requested: MenuInput,
): { input: MenuInput; conflicts: (keyof MenuInput)[] } {
  const input = { ...current } as Record<keyof MenuInput, unknown>;
  const conflicts: (keyof MenuInput)[] = [];
  for (const key of Object.keys(requested) as (keyof MenuInput)[]) {
    if (STAFF_FIELDS.has(key) || sameValue(base[key], requested[key])) continue;
    if (!sameValue(base[key], current[key]) && !sameValue(current[key], requested[key])) conflicts.push(key);
    input[key] = requested[key];
  }
  return { input: input as MenuInput, conflicts };
}

/** 今の内容と変更の申請の差分（組合の審査の画面に出す）。変えられない項目は比べない */
export function diffPlanInput(before: MenuInput, after: MenuInput, activityName: (id: string | null) => string) {
  const changes: PlanChange[] = [];
  const skip = new Set(['slug', 'status', 'operatorId', 'featured']);
  for (const key of Object.keys(MENU_FIELD_LABELS) as (keyof MenuInput)[]) {
    if (skip.has(key)) continue;
    const a = before[key];
    const b = after[key];
    let left: string;
    let right: string;
    if (key === 'prices') {
      left = priceLines(before.prices);
      right = priceLines(after.prices);
    } else if (key === 'activityId') {
      left = activityName(before.activityId);
      right = activityName(after.activityId);
    } else {
      left = show(a);
      right = show(b);
    }
    if (left !== right) changes.push({ field: key, label: MENU_FIELD_LABELS[key], before: left, after: right });
  }
  return changes;
}
