import { and, eq, ilike, inArray, or } from 'drizzle-orm';
import type { DbOrTx } from '@/db/client';
import {
  activities,
  bookings,
  inquiries,
  menuTranslations,
  menus,
  operatorApplications,
  operators,
  scheduleRules,
  settlements,
  slots,
} from '@/db/schema';
import { formatDateLabel, formatMonthLabel, localTime } from '@/lib/dates';
import { DEFAULT_LOCALE } from '@/lib/locale';
import { isMonthString, isUuid } from '@/lib/validation';
import { splitPlanTitle } from '@/modules/catalog/display-title';
import { INQUIRY_KIND_LABELS } from '@/modules/content/inquiries';
import { isSitePageSlug, SITE_PAGES } from '@/modules/content/pages';

const key = (type: string, id: string) => `${type}:${id}`;

/** 記録の対象（種類と id）。回の設定の記録は、記録した値（before・after）からプランを引く */
type AuditTarget = { targetType: string; targetId: string; before?: unknown; after?: unknown };

/** 回の設定（毎週の回・特定の日の変更）の記録の種類 */
const SCHEDULE_TARGETS = ['schedule_rule', 'schedule_exception'] as const;

/** 記録した値から、1 つの項目を文字で取り出す（削除の記録は after がなく before だけ） */
function recorded(t: AuditTarget, field: string): string | null {
  for (const value of [t.after, t.before]) {
    if (value && typeof value === 'object' && field in value) {
      const v = (value as Record<string, unknown>)[field];
      if (typeof v === 'string' && v) return v;
    }
  }
  return null;
}

/** 時刻（HH:MM:SS）を HH:MM に、日付（YYYY-MM-DD）を「10月5日」にする */
const hhmm = (time: string | null) => (time ? time.slice(0, 5) : null);
const monthDay = (date: string | null) =>
  date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日` : null;

/**
 * 記録の対象へのリンクのうち、対象の id だけでは決まらないもの（回の設定はそのプランの「回の設定」、
 * 月の精算の計算はその月の精算の一覧）。ほかは null（auditTargetHref で決める）
 */
export function relatedTargetHref(t: AuditTarget): string | null {
  if ((SCHEDULE_TARGETS as readonly string[]).includes(t.targetType)) {
    const menuId = recorded(t, 'menuId');
    return isUuid(menuId) ? `/admin/menus/${menuId}/schedule` : null;
  }
  if (t.targetType === 'settlement_period' && isMonthString(t.targetId)) {
    return `/admin/settlements?period=${t.targetId}`;
  }
  return null;
}

/** LIKE 検索の特殊文字をエスケープする */
const likeText = (q: string) => `%${q.replace(/[%_\\]/g, '\\$&')}%`;

/**
 * 操作の記録の「対象」の名前（プラン名・予約番号・事業者名など）。記録の一覧で、何に対する操作かを開かずに分かるようにする。
 * 予約はお客様の名前ではなく予約番号、お問い合わせは種類と日時で出す（記録の一覧に個人の名前を並べない）。
 * 消えた対象・名前のない種類は含めない
 */
export async function describeAuditTargets(
  db: DbOrTx,
  params: { shopId: string; timezone: string; targets: AuditTarget[] },
): Promise<Map<string, string>> {
  const idsOf = (type: string) => [
    ...new Set(params.targets.filter((t) => t.targetType === type && isUuid(t.targetId)).map((t) => t.targetId)),
  ];
  const at = (d: Date) =>
    `${formatDateLabel(d, params.timezone).replace(/^\d+年/, '')} ${localTime(d, params.timezone)}`;
  const names = new Map<string, string>();
  const shop = params.shopId;
  // 回の設定の記録は、記録した値の menuId からプラン名を引く。定員の変更の記録は定員しか持たないので、
  // 今ある毎週の回（ルール）から引く（ルールを消したあとは引けない）
  const scheduleTargets = params.targets.filter((t) => (SCHEDULE_TARGETS as readonly string[]).includes(t.targetType));
  const ruleIds = [
    ...new Set(
      scheduleTargets
        .filter((t) => t.targetType === 'schedule_rule' && !recorded(t, 'menuId') && isUuid(t.targetId))
        .map((t) => t.targetId),
    ),
  ];
  const rules = new Map(
    ruleIds.length
      ? (
          await db
            .select({ id: scheduleRules.id, menuId: scheduleRules.menuId, startTime: scheduleRules.startTime })
            .from(scheduleRules)
            .innerJoin(menus, eq(menus.id, scheduleRules.menuId))
            .where(and(eq(menus.shopId, params.shopId), inArray(scheduleRules.id, ruleIds)))
        ).map((r) => [r.id, r])
      : [],
  );
  const scheduleOf = (t: AuditTarget) => ({
    menuId: recorded(t, 'menuId') ?? rules.get(t.targetId)?.menuId ?? null,
    startTime: recorded(t, 'startTime') ?? rules.get(t.targetId)?.startTime ?? null,
  });
  const scheduleMenuIds = [
    ...new Set(scheduleTargets.map((t) => scheduleOf(t).menuId).filter((id): id is string => isUuid(id))),
  ];
  const [menuIds, bookingIds, operatorIds, activityIds, settlementIds, slotIds, inquiryIds, applicationIds] = [
    'menu',
    'booking',
    'operator',
    'activity',
    'settlement',
    'slot',
    'inquiry',
    'operator_application',
  ].map(idsOf);
  const planTitle = (menuIdColumn: typeof menus.id | typeof slots.menuId) =>
    and(eq(menuTranslations.menuId, menuIdColumn), eq(menuTranslations.locale, DEFAULT_LOCALE));
  const planNames = new Map<string, string>();
  const allMenuIds = [...new Set([...menuIds, ...scheduleMenuIds])];
  await Promise.all([
    allMenuIds.length &&
      db
        .select({ id: menus.id, title: menuTranslations.title })
        .from(menus)
        .innerJoin(menuTranslations, planTitle(menus.id))
        .where(and(eq(menus.shopId, shop), inArray(menus.id, allMenuIds)))
        .then((rows) =>
          rows.forEach((r) => {
            planNames.set(r.id, splitPlanTitle(r.title).title);
            if (menuIds.includes(r.id)) names.set(key('menu', r.id), splitPlanTitle(r.title).title);
          }),
        ),
    bookingIds.length &&
      db
        .select({ id: bookings.id, no: bookings.bookingNo })
        .from(bookings)
        .where(and(eq(bookings.shopId, shop), inArray(bookings.id, bookingIds)))
        .then((rows) => rows.forEach((r) => names.set(key('booking', r.id), `予約 ${r.no}`))),
    operatorIds.length &&
      db
        .select({ id: operators.id, name: operators.name })
        .from(operators)
        .where(and(eq(operators.shopId, shop), inArray(operators.id, operatorIds)))
        .then((rows) => rows.forEach((r) => names.set(key('operator', r.id), r.name))),
    activityIds.length &&
      db
        .select({ id: activities.id, name: activities.name })
        .from(activities)
        .where(and(eq(activities.shopId, shop), inArray(activities.id, activityIds)))
        .then((rows) => rows.forEach((r) => names.set(key('activity', r.id), r.name))),
    settlementIds.length &&
      db
        .select({ id: settlements.id, period: settlements.period, name: operators.name })
        .from(settlements)
        .innerJoin(operators, eq(operators.id, settlements.operatorId))
        .where(and(eq(settlements.shopId, shop), inArray(settlements.id, settlementIds)))
        .then((rows) =>
          rows.forEach((r) => names.set(key('settlement', r.id), `${r.name}（${formatMonthLabel(r.period)}の精算）`)),
        ),
    slotIds.length &&
      db
        .select({ id: slots.id, startsAt: slots.startsAt, title: menuTranslations.title })
        .from(slots)
        .innerJoin(menuTranslations, planTitle(slots.menuId))
        .where(and(eq(slots.shopId, shop), inArray(slots.id, slotIds)))
        .then((rows) =>
          rows.forEach((r) => names.set(key('slot', r.id), `${splitPlanTitle(r.title).title} ${at(r.startsAt)} の回`)),
        ),
    inquiryIds.length &&
      db
        .select({ id: inquiries.id, kind: inquiries.kind, createdAt: inquiries.createdAt })
        .from(inquiries)
        .where(and(eq(inquiries.shopId, shop), inArray(inquiries.id, inquiryIds)))
        .then((rows) =>
          rows.forEach((r) =>
            names.set(key('inquiry', r.id), `お問い合わせ（${INQUIRY_KIND_LABELS[r.kind]}・${at(r.createdAt)}）`),
          ),
        ),
    applicationIds.length &&
      db
        .select({ id: operatorApplications.id, name: operatorApplications.companyName })
        .from(operatorApplications)
        .where(and(eq(operatorApplications.shopId, shop), inArray(operatorApplications.id, applicationIds)))
        .then((rows) => rows.forEach((r) => names.set(key('operator_application', r.id), `登録申請：${r.name}`))),
  ]);
  for (const t of params.targets) {
    if (t.targetType === 'site_page' && isSitePageSlug(t.targetId)) {
      names.set(key('site_page', t.targetId), `固定ページ：${SITE_PAGES[t.targetId]}`);
    }
    // 月の精算の計算（事業者ごとではなく、月のまとめての操作）
    if (t.targetType === 'settlement_period' && isMonthString(t.targetId)) {
      names.set(key('settlement_period', t.targetId), `${formatMonthLabel(t.targetId)}の精算`);
    }
    // 回の設定：プラン名と、どの回か（毎週の回は時刻、特定の日の変更は日付と時刻）
    const schedule = scheduleOf(t);
    const plan = planNames.get(schedule.menuId ?? '');
    if (plan && t.targetType === 'schedule_rule') {
      const time = hhmm(schedule.startTime);
      names.set(key(t.targetType, t.targetId), `${plan}：毎週の回${time ? ` ${time}` : ''}`);
    }
    if (plan && t.targetType === 'schedule_exception') {
      const day = monthDay(recorded(t, 'date'));
      const time = hhmm(schedule.startTime) ?? '終日';
      names.set(key(t.targetType, t.targetId), `${plan}：${day ? `${day} ${time}の` : ''}特定の日の変更`);
    }
  }
  return names;
}

/** 記録の対象の名前を引く（describeAuditTargets の結果から） */
export function targetName(names: Map<string, string>, targetType: string, targetId: string): string | null {
  return names.get(key(targetType, targetId)) ?? null;
}

/**
 * 「対象で探す」の言葉に合う、記録の対象の id（予約番号・プラン名・事業者名）。合うものがなければ空
 */
export async function findAuditTargetIds(db: DbOrTx, params: { shopId: string; q: string }): Promise<string[]> {
  const q = params.q.trim();
  if (!q) return [];
  const [bookingRows, menuRows, operatorRows] = await Promise.all([
    db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.shopId, params.shopId), eq(bookings.bookingNo, q.toUpperCase())))
      .limit(20),
    db
      .select({ id: menus.id })
      .from(menus)
      .innerJoin(
        menuTranslations,
        and(eq(menuTranslations.menuId, menus.id), eq(menuTranslations.locale, DEFAULT_LOCALE)),
      )
      .where(and(eq(menus.shopId, params.shopId), ilike(menuTranslations.title, likeText(q))))
      .limit(50),
    db
      .select({ id: operators.id })
      .from(operators)
      .where(and(eq(operators.shopId, params.shopId), or(ilike(operators.name, likeText(q)), eq(operators.slug, q))))
      .limit(50),
  ]);
  return [...bookingRows, ...menuRows, ...operatorRows].map((r) => r.id);
}
