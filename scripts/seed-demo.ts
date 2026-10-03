/**
 * デモ用のデータを作る（管理画面の確かめ・分析の画面の見本）。
 *   npm run seed:demo
 * - 過去 12 か月と先 3 か月の予約（申込・事業者の回答・支払案内・入金・確定・催行報告・実績確認・取消・天候中止・返金）、
 *   月次の精算、お問い合わせ、事業者の登録申請を作る
 * - 先に npm run seed（組合と管理者）と npm run import:ginowan（プラン・事業者）をしておくこと
 * - デモのデータは見分けられるようにする：お客様・お問い合わせのメールは demo+…@example.com、足したプランの slug は demo-…
 * - 一度作ったら何もしない（同じデータを二重に作らない）。乱数は固定なので、同じ日に作れば同じ内容になる
 * - 日時は「そのときに操作した」ように過去の日時で記録する（操作の記録のうち、精算の下書きの作成だけは実行した日時になる）
 * - 手元（localhost）以外の DB では、SEED_DEMO_CONFIRM=yes を付けないと動かない（本番に誤って入れないように）
 * - 実際の予約がすでにある DB では、精算は作らない（実際の予約の精算を「振込済み」にしないように）
 * - 消すときは scripts/clear-demo.ts（デモのデータだけを消す）
 */
import { randomUUID } from 'node:crypto';
import { and, asc, eq, gte, inArray, like, lt, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  auditLogs,
  bookingItems,
  bookingOperatorRequests,
  bookings,
  bookingStatusEvents,
  customers,
  inquiries,
  menuPrices,
  menus,
  menuTranslations,
  operatorApplications,
  operators,
  paymentReceipts,
  paymentRefunds,
  payments,
  scheduleRules,
  seasonPeriods,
  settlementItems,
  settlements,
  shopMembers,
  slots,
  type PolicySnapshot,
} from '@/db/schema';
import { addDays, addMonths, localDate, monthOf, zonedToUtc } from '@/lib/dates';
import { accessTokenExpiry } from '@/modules/booking/access-token';
import { generateBookingNo } from '@/modules/booking/booking-no';
import { cancellationFeePercent, daysBeforeActivity, feeSettingsOf } from '@/modules/booking/cancellation-fee';
import type { BookingStatus } from '@/modules/booking/status';
import { pricesForSeason, seasonOf } from '@/modules/catalog/season';
import { resyncMenu, syncSlots } from '@/modules/schedule/sync-slots';
import { buildSettlements, payoutDateOf } from '@/modules/settlement/settlements';
import { paymentDueAt, resolveSettings } from '@/modules/shop/settings';
import { getCurrentShop } from '@/modules/shop/shops';
import { getDatabaseUrl } from '@/db/url';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// ---- 乱数（固定の種。同じ日に作れば同じ内容になる） ----
let seed = 20261003;
function rand(): number {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const chance = (p: number) => rand() < p;
const between = (a: number, b: number) => a + rand() * (b - a);
const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];
function weighted<T>(entries: readonly (readonly [T, number])[]): T {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [value, w] of entries) {
    r -= w;
    if (r <= 0) return value;
  }
  return entries[entries.length - 1][0];
}
function poisson(lambda: number): number {
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rand();
  } while (p > limit);
  return k - 1;
}

// ---- デモの内容 ----
/** 月ごとの混み具合（沖縄のマリンレジャー：夏が多く、冬は少ない） */
const MONTH_FACTOR = [0.35, 0.4, 0.6, 0.6, 0.75, 0.55, 1.0, 1.2, 0.9, 0.7, 0.5, 0.4];
/** 曜日ごと（0＝日） */
const WEEKDAY_FACTOR = [1.35, 0.8, 0.75, 0.8, 0.85, 1.0, 1.45];
/** 申込の多さの全体の倍率（増やす・減らすときはここ） */
const SCALE = 0.75;

/** 台風などで中止にした日（その日の回をすべて天候中止にする） */
const WEATHER_DAYS = [
  '2025-10-07',
  '2025-10-08',
  '2026-02-18',
  '2026-06-02',
  '2026-07-14',
  '2026-07-15',
  '2026-08-11',
  '2026-08-27',
  '2026-09-08',
  '2026-09-21',
];

const FAMILY = [
  '比嘉',
  '金城',
  '大城',
  '宮城',
  '新垣',
  '玉城',
  '上原',
  '島袋',
  '平良',
  '山城',
  '佐藤',
  '鈴木',
  '高橋',
  '田中',
  '伊藤',
  '渡辺',
  '山本',
  '中村',
  '小林',
  '加藤',
  '吉田',
  '山田',
  '松本',
  '井上',
  '木村',
  '林',
  '清水',
  '山口',
  '森',
  '池田',
];
const GIVEN = [
  '太郎',
  '花子',
  '健太',
  '美咲',
  '翔太',
  '結衣',
  '大輔',
  '彩',
  '拓也',
  '愛',
  '直樹',
  '恵',
  '亮',
  '優子',
  '誠',
  'さくら',
  '陽菜',
  '蓮',
  '葵',
  '湊',
];

type DemoPlan = {
  slug: string;
  operatorSlug: string;
  operatorName: string;
  category: 'fishing' | 'whale_watching' | 'cruise';
  title: string;
  summary: string;
  durationMin: number;
  capacityUnit: '名' | '艇';
  maxPartySize: number;
  minPartySize: number;
  includedGuests?: number;
  extraGuestPrice?: number;
  maxGuests?: number;
  prices: { label: string; price: number }[];
  times: { startTime: string; capacity: number }[];
  /** 回を作る期間（季節もの）。なければ通年 */
  seasons?: { from: string; to: string }[];
};

/** 取り込んだプランのほかに足すデモのプラン（事業者・時間帯・貸切の見本。お客様のサイトでは受付停止） */
const DEMO_PLANS: DemoPlan[] = [
  {
    slug: 'demo-boat-fishing',
    operatorSlug: 'recsea',
    operatorName: '釣船レクシー',
    category: 'fishing',
    title: 'ボート釣り体験（2時間）（デモ）',
    summary: '宜野湾沖で手軽に楽しめる釣り体験。竿・エサ付きで手ぶらで参加できます。（デモ用のプラン）',
    durationMin: 120,
    capacityUnit: '名',
    maxPartySize: 8,
    minPartySize: 2,
    prices: [
      { label: '大人', price: 6000 },
      { label: '子供（小学生）', price: 4000 },
    ],
    times: [
      { startTime: '08:00', capacity: 8 },
      { startTime: '10:30', capacity: 8 },
      { startTime: '13:00', capacity: 8 },
      { startTime: '15:30', capacity: 8 },
    ],
  },
  {
    slug: 'demo-whale-watching',
    operatorSlug: 'seaworks',
    operatorName: 'シーワークス沖縄アイランド',
    category: 'whale_watching',
    title: 'ホエールウォッチング（デモ）',
    summary: '冬の沖縄の海に訪れるザトウクジラを見に行くツアーです。（デモ用のプラン）',
    durationMin: 150,
    capacityUnit: '名',
    maxPartySize: 10,
    minPartySize: 1,
    prices: [
      { label: '大人', price: 6500 },
      { label: '子供（3〜12歳）', price: 4500 },
    ],
    times: [
      { startTime: '09:00', capacity: 25 },
      { startTime: '13:00', capacity: 25 },
    ],
    seasons: [
      { from: '2026-01-10', to: '2026-03-31' },
      { from: '2027-01-10', to: '2027-03-31' },
    ],
  },
  {
    slug: 'demo-kerama-charter',
    operatorSlug: 'seaworks',
    operatorName: 'シーワークス沖縄アイランド',
    category: 'cruise',
    title: 'ケラマ諸島 貸切チャーター（6時間）（デモ）',
    summary:
      '慶良間諸島へ船を貸し切って向かうチャーターです。10名まで基本料金、それを超える方は追加料金。（デモ用のプラン）',
    durationMin: 360,
    capacityUnit: '艇',
    maxPartySize: 1,
    minPartySize: 1,
    includedGuests: 10,
    extraGuestPrice: 3000,
    maxGuests: 35,
    prices: [{ label: 'チャーター料金（10名まで）', price: 150000 }],
    times: [{ startTime: '09:00', capacity: 1 }],
  },
];

/** プランごとの 1 回あたりの申込の多さ（混み具合の倍率をかける前） */
const PLAN_DEMAND: Record<string, number> = {
  'ginowan-parasailing': 1.0,
  'ginowan-flyboard': 0.6,
  'demo-boat-fishing': 0.45,
  'demo-whale-watching': 2.6,
  'demo-kerama-charter': 0.22,
};
/** 時間帯ごと（昼前後が多い） */
function hourFactor(hhmm: string): number {
  const h = Number(hhmm.slice(0, 2));
  if (h < 9) return 0.7;
  if (h < 11) return 1.15;
  if (h < 14) return 1.25;
  if (h < 16) return 0.95;
  return 0.7;
}

type EventRow = typeof bookingStatusEvents.$inferInsert;
type AuditRow = typeof auditLogs.$inferInsert;

async function insertChunks<T>(label: string, rows: T[], insert: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += 500) await insert(rows.slice(i, i + 500));
  console.info(`  ${label}: ${rows.length}`);
}

async function main() {
  const host = new URL(getDatabaseUrl()).hostname;
  if (!['localhost', '127.0.0.1'].includes(host) && process.env.SEED_DEMO_CONFIRM !== 'yes') {
    throw new Error(`手元以外の DB（${host}）です。入れてよいときだけ SEED_DEMO_CONFIRM=yes を付けて動かしてください`);
  }
  const shop = await getCurrentShop(db);
  const tz = shop.timezone;
  const settings = resolveSettings(shop.settings);
  const fees = feeSettingsOf(settings);
  const now = new Date();
  const today = localDate(now, tz);
  const startMonth = addMonths(monthOf(today), -12);
  const START = `${startMonth}-01`;
  const END = addDays(today, 92);

  const [already] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.shopId, shop.id), like(customers.emailNormalized, 'demo+%@example.com')))
    .limit(1);
  if (already) {
    console.info('デモのデータはもうあります（何もしません）');
    return;
  }
  const [member] = await db
    .select({ userId: shopMembers.userId })
    .from(shopMembers)
    .where(eq(shopMembers.shopId, shop.id))
    .limit(1);
  if (!member) throw new Error('組合の管理者がいません（先に npm run seed）');
  const adminId = member.userId;

  // ---- プランと事業者 ----
  const baseSlugs = ['ginowan-parasailing', 'ginowan-flyboard'];
  const base = await db
    .select()
    .from(menus)
    .where(and(eq(menus.shopId, shop.id), inArray(menus.slug, baseSlugs)));
  if (base.length !== baseSlugs.length) throw new Error('取り込んだプランがありません（先に npm run import:ginowan）');

  const operatorIdOf = async (slug: string, name: string) => {
    const [found] = await db
      .select({ id: operators.id })
      .from(operators)
      .where(and(eq(operators.shopId, shop.id), eq(operators.slug, slug)));
    if (found) return found.id;
    const [created] = await db
      .insert(operators)
      .values({ shopId: shop.id, slug, name })
      .returning({ id: operators.id });
    return created.id;
  };

  for (const plan of DEMO_PLANS) {
    const [exists] = await db
      .select({ id: menus.id })
      .from(menus)
      .where(and(eq(menus.shopId, shop.id), eq(menus.slug, plan.slug)));
    if (exists) continue;
    const operatorId = await operatorIdOf(plan.operatorSlug, plan.operatorName);
    const [menu] = await db
      .insert(menus)
      .values({
        shopId: shop.id,
        slug: plan.slug,
        // お客様のサイトからは申し込めないようにしておく（管理画面・分析の見本）
        status: 'paused',
        pausedBy: 'staff',
        category: plan.category,
        durationMin: plan.durationMin,
        maxPartySize: plan.maxPartySize,
        minPartySize: plan.minPartySize,
        bookingCutoffMin: 120,
        operatorId,
        capacityUnit: plan.capacityUnit,
        includedGuests: plan.includedGuests ?? null,
        extraGuestPrice: plan.extraGuestPrice ?? null,
        maxGuests: plan.maxGuests ?? null,
      })
      .returning();
    await db.insert(menuTranslations).values({
      menuId: menu.id,
      locale: 'ja',
      title: plan.title,
      summary: plan.summary,
      description: plan.summary,
      meetingPoint: '宜野湾港マリーナ',
    });
    await db.insert(menuPrices).values(plan.prices.map((p, i) => ({ menuId: menu.id, ...p, sortOrder: i })));
    const seasons = plan.seasons ?? [{ from: START, to: null as string | null }];
    await db.insert(scheduleRules).values(
      seasons.flatMap((s) =>
        plan.times.map((t) => ({
          menuId: menu.id,
          validFrom: s.from,
          validTo: s.to,
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          ...t,
        })),
      ),
    );
  }

  const planMenus = await db
    .select()
    .from(menus)
    .where(and(eq(menus.shopId, shop.id), inArray(menus.slug, [...baseSlugs, ...DEMO_PLANS.map((p) => p.slug)])));
  // 取り込んだプランの回のルールは「取り込んだ日から」なので、過去の回も作れるよう始まりを 1 年前にする
  for (const menu of planMenus) {
    if (!baseSlugs.includes(menu.slug)) continue;
    await db
      .update(scheduleRules)
      .set({ validFrom: START })
      .where(and(eq(scheduleRules.menuId, menu.id), sql`${scheduleRules.validFrom} > ${START}`));
  }
  console.info('回を作ります…');
  for (const menu of planMenus) {
    await syncSlots(db, { menuId: menu.id, fromDate: START, toDate: addDays(today, -1) });
    await resyncMenu(db, { menuId: menu.id, timezone: tz, now });
  }

  const priceRows = await db
    .select()
    .from(menuPrices)
    .where(
      and(
        inArray(
          menuPrices.menuId,
          planMenus.map((m) => m.id),
        ),
        sql`${menuPrices.archivedAt} is null`,
      ),
    )
    .orderBy(asc(menuPrices.sortOrder));
  const periods = await db.select().from(seasonPeriods);
  const translations = await db
    .select()
    .from(menuTranslations)
    .where(
      and(
        inArray(
          menuTranslations.menuId,
          planMenus.map((m) => m.id),
        ),
        eq(menuTranslations.locale, 'ja'),
      ),
    );
  const allSlots = await db
    .select()
    .from(slots)
    .where(
      and(
        inArray(
          slots.menuId,
          planMenus.map((m) => m.id),
        ),
        gte(slots.startsAt, zonedToUtc(START, '00:00', tz)),
        lt(slots.startsAt, zonedToUtc(END, '00:00', tz)),
      ),
    )
    .orderBy(asc(slots.startsAt));
  console.info(`回：${allSlots.length}`);

  // ---- お客様 ----
  const customerRows: (typeof customers.$inferInsert)[] = [];
  let customerSeq = 0;
  const newCustomer = (at: Date) => {
    customerSeq++;
    const name = `${pick(FAMILY)} ${pick(GIVEN)}`;
    const row = {
      id: randomUUID(),
      shopId: shop.id,
      name,
      emailNormalized: `demo+${String(customerSeq).padStart(4, '0')}@example.com`,
      phoneE164: `+819000${String(100000 + Math.floor(rand() * 899999))}`,
      locale: 'ja',
      createdAt: at,
      updatedAt: at,
    };
    customerRows.push(row);
    return row;
  };

  // ---- 予約 ----
  const bookingRows: (typeof bookings.$inferInsert)[] = [];
  const itemRows: (typeof bookingItems.$inferInsert)[] = [];
  const paymentRows: (typeof payments.$inferInsert)[] = [];
  const receiptRows: (typeof paymentReceipts.$inferInsert)[] = [];
  const refundRows: (typeof paymentRefunds.$inferInsert)[] = [];
  const eventRows: EventRow[] = [];
  const requestRows: (typeof bookingOperatorRequests.$inferInsert)[] = [];
  const auditRows: AuditRow[] = [];
  const reserved = new Map<string, number>();
  const weatherSlots = new Set<string>();

  for (const slot of allSlots) {
    const menu = planMenus.find((m) => m.id === slot.menuId)!;
    const date = localDate(slot.startsAt, tz);
    const hhmm = slot.startsAt.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
    const weatherDay = WEATHER_DAYS.includes(date);
    if (weatherDay && slot.startsAt < now) weatherSlots.add(slot.id);
    const month = Number(date.slice(5, 7)) - 1;
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const lambda =
      (PLAN_DEMAND[menu.slug] ?? 0.5) * MONTH_FACTOR[month] * WEEKDAY_FACTOR[weekday] * hourFactor(hhmm) * SCALE;
    const count = poisson(lambda);
    const byBoat = menu.capacityUnit !== '名';
    const translation = translations.find((t) => t.menuId === menu.id);
    const season = seasonOf(
      date,
      periods.filter((p) => p.operatorId === menu.operatorId),
    );
    const prices = pricesForSeason(
      priceRows.filter((p) => p.menuId === menu.id),
      season,
    );
    if (prices.length === 0) continue;

    for (let n = 0; n < count; n++) {
      // 申込から参加日までの日数
      const leadDays = weighted([
        [0, 5],
        [1, 10],
        [between(2, 3.99), 15],
        [between(4, 7.99), 20],
        [between(8, 14.99), 20],
        [between(15, 30.99), 18],
        [between(31, 60.99), 9],
        [between(61, 90), 3],
      ] as const);
      const source =
        leadDays === 0 && chance(0.4)
          ? 'walk_in'
          : weighted([
              ['web', 72],
              ['phone', 16],
              ['line', 9],
            ] as const);
      const created = new Date(
        leadDays === 0
          ? slot.startsAt.getTime() - between(source === 'web' ? 2.5 : 0.5, 8) * HOUR
          : slot.startsAt.getTime() - leadDays * DAY - between(0, 10) * HOUR,
      );
      if (created > now) continue;
      // 中止を決めたあとの申込は受けない
      if (weatherDay && created > zonedToUtc(addDays(date, -1), '17:00', tz)) continue;
      // 申込の時刻は朝 7 時〜夜 23 時（夜中は少ない）
      const hourJst = Number(created.toLocaleString('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }));
      if (hourJst < 7 && chance(0.85)) continue;

      // 人数と料金
      const partySize = byBoat
        ? 1
        : Math.min(
            menu.maxPartySize,
            Math.max(
              menu.minPartySize,
              weighted([
                [1, 15],
                [2, 40],
                [3, 15],
                [4, 18],
                [5, 6],
                [6, 4],
                [8, 2],
              ] as const),
            ),
          );
      const used = reserved.get(slot.id) ?? slot.reservedCount;
      if (used + partySize > slot.capacity) continue;
      const guestCount = byBoat ? Math.round(between(4, Math.min(menu.maxGuests ?? 20, 22))) : null;
      const extraCount = byBoat && menu.includedGuests ? Math.max(0, guestCount! - menu.includedGuests) : 0;
      const extraAmount = extraCount * (menu.extraGuestPrice ?? 0);
      const primary = byBoat ? prices[0] : weighted(prices.map((p, i) => [p, i === 0 ? 3 : 1] as const));
      const child = prices.find((p) => p !== primary && /子供|小学生|こども/.test(p.label));
      const childCount =
        !byBoat && child && partySize >= 3 && chance(0.35) ? Math.min(partySize - 1, Math.ceil(rand() * 2)) : 0;
      const lines = [
        { priceId: primary.id, label: primary.label, unitPrice: primary.price, quantity: partySize - childCount },
        ...(childCount > 0 && child
          ? [{ priceId: child.id, label: child.label, unitPrice: child.price, quantity: childCount }]
          : []),
      ];
      const totalAmount = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0) + extraAmount;

      // お客様（1 割ほどはリピーター）
      const repeat = customerRows.length > 30 && chance(0.1) ? pick(customerRows.slice(0, -10)) : null;
      const customer = repeat ?? newCustomer(created);

      const bookingId = randomUUID();
      const paymentId = randomUUID();
      const operatorId = menu.operatorId;
      const events: {
        at: Date;
        from: BookingStatus | null;
        to: BookingStatus;
        actor: EventRow['actorType'];
        note: string;
      }[] = [];
      const ev = (
        at: Date,
        from: BookingStatus | null,
        to: BookingStatus,
        actor: EventRow['actorType'],
        note: string,
      ) => {
        if (at <= now) events.push({ at, from, to, actor, note });
        return at <= now;
      };
      const audit = (at: Date, row: Omit<AuditRow, 'shopId' | 'createdAt'>) => {
        if (at <= now) auditRows.push({ shopId: shop.id, createdAt: at, ...row });
      };
      const start = slot.startsAt;
      const isWeb = source === 'web';
      const paymentMethod: 'online' | 'onsite' = isWeb
        ? 'online'
        : source === 'walk_in' || chance(0.45)
          ? 'onsite'
          : 'online';
      let operatorAgreement = '';
      let cancel: { at: Date; category: string; reason: string; refundPercent: number } | null = null;
      let dueAt: Date | null = null;
      const receipts: { at: Date; amount: number }[] = [];
      let confirmedAt: Date | null = null;
      let request: {
        at: Date;
        respondedAt: Date | null;
        status: 'pending' | 'accepted' | 'declined' | 'conditional';
      } | null = null;

      if (isWeb) {
        ev(created, null, 'requested', 'customer', 'Web から申込');
        const tReq = new Date(created.getTime() + between(1, 5) * MIN);
        if (
          ev(tReq, 'requested', 'operator_checking', 'system', 'プランの事業者へ、自動で受入確認を依頼') &&
          operatorId
        ) {
          request = { at: tReq, respondedAt: null, status: 'pending' };
          audit(tReq, {
            actorId: null,
            actorType: 'system',
            action: 'booking.request_operator',
            targetType: 'booking',
            targetId: bookingId,
            after: { operatorIds: [operatorId], note: '' },
          });
        }
        /** from から hours 時間後。ただし開始までの残りの frac の割合より後にはしない（開始の前に手続きが進むように） */
        const within = (from: Date, hours: number, frac: number) =>
          new Date(from.getTime() + Math.min(hours * HOUR, (start.getTime() - from.getTime()) * frac));
        const room = start.getTime() - tReq.getTime();
        // 最近の申込は、半分ほどをまだ手続きの途中にする（ダッシュボードの「要対応」の見本）
        const recent = now.getTime() - created.getTime() < 2 * DAY && chance(0.5);
        const delay = Math.min(
          (recent ? between(20, 60) : 1) *
            weighted([
              [between(0.2, 1), 30],
              [between(1, 3), 35],
              [between(3, 8), 20],
              [between(8, 20), 15],
            ] as const) *
            HOUR,
          room * 0.3,
        );
        const tResp = new Date(tReq.getTime() + delay);
        const response = weighted([
          ['accepted', 90],
          ['conditional', 5],
          ['declined', 3],
        ] as const);
        const label = {
          accepted: '受入可',
          conditional: '条件付きで可（集合を 30 分早めてほしい）',
          declined: '受入不可（船の整備のため）',
        }[response];
        let ready: Date | null = null;
        if (request && ev(tResp, 'operator_checking', 'operator_checking', 'operator', `事業者の回答：${label}`)) {
          request = { ...request, respondedAt: tResp, status: response };
          audit(tResp, {
            actorId: null,
            actorType: 'operator',
            action: 'booking.operator_response',
            targetType: 'booking',
            targetId: bookingId,
            after: { operatorId, response, note: response === 'accepted' ? '' : label },
          });
          if (response === 'declined') {
            const at = new Date(tResp.getTime() + between(0.5, 4) * HOUR);
            if (ev(at, 'operator_checking', 'cancelled', 'staff', '実施事業者の手配ができないため取消')) {
              cancel = { at, category: 'unavailable', reason: '実施事業者の手配ができないため', refundPercent: 100 };
            }
          } else if (response === 'conditional') {
            const tReview = within(tResp, between(0.5, 3), 0.3);
            if (ev(tReview, 'operator_checking', 'reviewing', 'staff', '条件付きの回答のため、お客様と調整')) {
              operatorAgreement = '集合を 30 分早めることで、お客様と合意';
              ready = within(tReview, between(1, 12), 0.3);
            }
          } else {
            // 3 割ほどは、組合が支払案内を送るまで時間がかかる（ダッシュボードの「事業者の回答あり」の見本）
            ready = within(tResp, chance(0.3) ? between(6, 30) : between(0.3, 4), 0.3);
          }
        }
        if (ready && !cancel) {
          const from: BookingStatus = operatorAgreement ? 'reviewing' : 'operator_checking';
          if (ready < start && ev(ready, from, 'awaiting_payment', 'staff', '支払案内を送信')) {
            dueAt = paymentDueAt({ now: ready, startsAt: start, days: settings.paymentDueDays, timezone: tz });
            const behavior = weighted([
              ['pay', 92],
              ['cancel', 4],
              ['expire', 4],
            ] as const);
            if (behavior === 'pay') {
              const paidAt = new Date(
                ready.getTime() + between(0.05, 0.85) * (dueAt.getTime() - ready.getTime()) * (recent ? 3 : 1),
              );
              // 振込は「入金を確かめた日の 12:00」で記録し、確定はそのあと
              let receivedAt = zonedToUtc(localDate(paidAt, tz), '12:00', tz);
              let tConfirm = new Date(Math.max(paidAt.getTime(), receivedAt.getTime()) + between(0.2, 5) * HOUR);
              // 開始の直前に払われたときは、開始の前に確定する
              if (tConfirm >= start) {
                tConfirm = new Date(Math.max(paidAt.getTime(), start.getTime() - 10 * MIN));
                if (receivedAt > tConfirm) receivedAt = tConfirm;
              }
              if (tConfirm <= now) {
                receipts.push({ at: receivedAt, amount: totalAmount });
                ev(tConfirm, 'awaiting_payment', 'confirmed', 'staff', '入金を確認（振込）');
                confirmedAt = tConfirm;
              }
            } else if (behavior === 'cancel') {
              const at = new Date(ready.getTime() + between(0.1, 0.8) * (dueAt.getTime() - ready.getTime()));
              if (ev(at, 'awaiting_payment', 'cancelled', 'staff', 'お客様のご都合で取消')) {
                cancel = { at, category: 'customer', reason: '予定が変わったため', refundPercent: 100 };
              }
            } else {
              const at = new Date(dueAt.getTime() + between(1, chance(0.5) ? 72 : 12) * HOUR);
              if (ev(at, 'awaiting_payment', 'cancelled', 'staff', '支払期限を過ぎたため取消')) {
                cancel = { at, category: 'customer', reason: '支払期限までに入金がなかったため', refundPercent: 100 };
              }
            }
          }
        }
      } else {
        const label = { phone: '電話で受付', line: 'LINE で受付', walk_in: '店頭で受付' }[source];
        ev(created, null, 'confirmed', 'staff', `${label}（実施事業者の受入は電話などで確認済み）`);
        confirmedAt = created;
        if (paymentMethod === 'online') receipts.push({ at: created, amount: totalAmount });
      }

      // 確定のあと
      if (confirmedAt && !cancel) {
        const weatherAt = zonedToUtc(addDays(date, -1), '17:00', tz);
        const afterConfirm = (at: Date) => (at > confirmedAt! ? at : new Date(confirmedAt!.getTime() + 10 * MIN));
        if (weatherDay) {
          const at = afterConfirm(weatherAt < start ? weatherAt : new Date(start.getTime() - 2 * HOUR));
          if (ev(at, 'confirmed', 'weather_cancelled', 'staff', '天候・海況のため中止')) {
            cancel = {
              at,
              category: 'weather',
              reason: '強風・高波のため',
              refundPercent: settings.weatherRefundPercent,
            };
          }
        } else if (chance(0.045)) {
          const at = new Date(confirmedAt.getTime() + between(0.1, 0.95) * (start.getTime() - confirmedAt.getTime()));
          const fee = cancellationFeePercent(fees, daysBeforeActivity({ startsAt: start, now: at, timezone: tz }));
          if (ev(at, 'confirmed', 'cancelled', 'staff', `お客様のご都合で取消（キャンセル料 ${fee}%）`)) {
            cancel = { at, category: 'customer', reason: '体調不良のため', refundPercent: 100 - fee };
          }
        } else if (chance(0.005)) {
          const at = new Date(start.getTime() - between(2, 30) * HOUR);
          if (at > confirmedAt && ev(at, 'confirmed', 'cancelled', 'staff', '事業者の都合で取消（船の故障）')) {
            cancel = { at, category: 'unavailable', reason: '船の故障のため', refundPercent: 100 };
          }
        } else {
          const end = new Date(start.getTime() + menu.durationMin * MIN);
          if (chance(0.015)) {
            const at = new Date(end.getTime() + between(0.5, 6) * HOUR);
            ev(at, 'confirmed', 'no_show', 'operator', '催行報告：無断キャンセル');
          } else {
            const tReport = new Date(
              end.getTime() +
                weighted([
                  [between(0.3, 3), 60],
                  [between(3, 24), 30],
                  [between(24, 72), 10],
                ] as const) *
                  HOUR,
            );
            const people = byBoat ? guestCount! : partySize;
            if (ev(tReport, 'confirmed', 'completed', 'operator', `催行報告：実施（${people}名）`)) {
              const tVerify = new Date(tReport.getTime() + between(0.3, 4) * DAY);
              ev(tVerify, 'completed', 'verified', 'staff', '実績を確認');
            }
          }
        }
      }

      // 天候の日：まだ確定していない申込も取り消す
      if (weatherDay && !cancel && events.length > 0) {
        const last = events[events.length - 1];
        if (['requested', 'reviewing', 'operator_checking', 'awaiting_payment'].includes(last.to)) {
          const at = new Date(
            Math.max(zonedToUtc(addDays(date, -1), '17:00', tz).getTime(), last.at.getTime() + 10 * MIN),
          );
          if (ev(at, last.to, 'cancelled', 'staff', '天候・海況のため中止')) {
            cancel = { at, category: 'weather', reason: '強風・高波のため', refundPercent: 100 };
          }
        }
      }
      if (events.length === 0) continue;
      const last = events[events.length - 1];
      const status = last.to;

      // お金
      const paid = receipts.filter((r) => r.at <= now).reduce((s, r) => s + r.amount, 0);
      let refundDue: number | null = null;
      let refunded = 0;
      let refundedAt: Date | null = null;
      if (cancel && paid > 0) {
        refundDue = Math.min(paid, Math.floor((paid * cancel.refundPercent) / 100));
        if (refundDue > 0) {
          const at = new Date(cancel.at.getTime() + between(1, 6) * DAY);
          // 最近の取消は返金待ちのまま残す（ダッシュボードの「返金待ち」の見本）
          if (at <= now) {
            refunded = refundDue;
            refundedAt = zonedToUtc(localDate(at, tz), '15:00', tz);
            refundRows.push({
              shopId: shop.id,
              paymentId,
              amount: refundDue,
              refundedAt,
              status: 'succeeded',
              note: '振込で返金',
              createdBy: adminId,
              createdAt: refundedAt,
              updatedAt: refundedAt,
            });
          }
        }
      }
      const paymentStatus =
        paid === 0
          ? cancel
            ? 'expired'
            : 'pending'
          : refunded === 0
            ? 'paid'
            : refunded >= paid
              ? 'refunded'
              : 'partially_refunded';

      if (status !== 'cancelled' && status !== 'weather_cancelled') reserved.set(slot.id, used + partySize);
      const reportEvent = events.find((e) => e.to === 'completed' || e.to === 'no_show');
      const policySnapshot: PolicySnapshot = {
        commonCancellationPolicy: settings.commonCancellationPolicy,
        commonWeatherPolicy: settings.commonWeatherPolicy,
        cancellationRates: fees,
        conditions: translation?.conditions ?? null,
        notes: translation?.notes ?? null,
        cancellationPolicy: translation?.cancellationPolicy ?? null,
        weatherPolicy: translation?.weatherPolicy ?? null,
      };
      bookingRows.push({
        id: bookingId,
        shopId: shop.id,
        bookingNo: generateBookingNo(),
        slotId: slot.id,
        customerId: customer.id!,
        source,
        status,
        paymentMethod,
        totalAmount,
        partySize,
        guestCount,
        extraGuestAmount: extraAmount,
        extraGuestCount: extraCount,
        locale: 'ja',
        contactName: customer.name,
        contactEmail: customer.emailNormalized,
        contactPhone: customer.phoneE164,
        policySnapshot,
        accessTokenExpiresAt: accessTokenExpiry(start, menu.durationMin),
        cancelledAt: cancel?.at ?? null,
        cancelReason: cancel?.reason ?? null,
        cancelCategory: cancel?.category ?? null,
        cancellationFeeToOperator: cancel && confirmedAt ? settings.cancellationFeeToOperator : null,
        createdBy: isWeb ? null : adminId,
        operatorId,
        operatorAgreement,
        consentedAt: isWeb ? created : null,
        customerNote:
          isWeb && chance(0.2)
            ? pick([
                '初めてです。よろしくお願いします。',
                '子供が泳げませんが大丈夫でしょうか。',
                '駐車場はありますか？',
                '記念日なので写真をたくさん撮りたいです。',
              ])
            : null,
        reportResult: reportEvent ? (reportEvent.to === 'completed' ? 'done' : 'no_show') : null,
        actualPartySize: reportEvent?.to === 'completed' ? (byBoat ? guestCount : partySize) : null,
        reportedAt: reportEvent?.at ?? null,
        createdAt: created,
        updatedAt: last.at,
      });
      itemRows.push(
        ...lines.map((l) => ({ id: randomUUID(), bookingId, ...l, createdAt: created, updatedAt: created })),
      );
      paymentRows.push({
        id: paymentId,
        shopId: shop.id,
        bookingId,
        method: paymentMethod,
        amount: paid > 0 ? paid : totalAmount,
        refundedAmount: refunded,
        status: paymentStatus,
        receivedAt: receipts[0]?.at ?? null,
        receivedBy: receipts.length > 0 ? adminId : null,
        dueAt,
        refundDueAmount: refundDue,
        refundedAt,
        createdAt: created,
        updatedAt: last.at,
      });
      receiptRows.push(
        ...receipts
          .filter((r) => r.at <= now)
          .map((r) => ({
            id: randomUUID(),
            shopId: shop.id,
            paymentId,
            amount: r.amount,
            receivedAt: r.at,
            method: 'transfer' as const,
            purpose: 'payment' as const,
            note: isWeb ? '振込（デモ）' : '予約の登録時に入金済み',
            createdBy: adminId,
            createdAt: r.at,
          })),
      );
      eventRows.push(
        ...events.map((e) => ({
          bookingId,
          fromStatus: e.from,
          toStatus: e.to,
          actorType: e.actor,
          actorId: e.actor === 'staff' ? adminId : null,
          note: e.note,
          createdAt: e.at,
        })),
      );
      if (request && operatorId) {
        requestRows.push({
          bookingId,
          operatorId,
          status: request.status,
          responseNote: request.status === 'accepted' || request.status === 'pending' ? '' : '（デモ）',
          requestedAt: request.at,
          respondedAt: request.respondedAt,
          createdAt: request.at,
          updatedAt: request.respondedAt ?? request.at,
        });
      }
    }
  }

  console.info('書き込みます…');
  await insertChunks('お客様', customerRows, (c) => db.insert(customers).values(c));
  await insertChunks('予約', bookingRows, (c) => db.insert(bookings).values(c));
  await insertChunks('料金の内訳', itemRows, (c) => db.insert(bookingItems).values(c));
  await insertChunks('支払い', paymentRows, (c) => db.insert(payments).values(c));
  await insertChunks('入金', receiptRows, (c) => db.insert(paymentReceipts).values(c));
  await insertChunks('返金', refundRows, (c) => db.insert(paymentRefunds).values(c));
  await insertChunks('状態の履歴', eventRows, (c) => db.insert(bookingStatusEvents).values(c));
  await insertChunks('受入確認', requestRows, (c) => db.insert(bookingOperatorRequests).values(c));
  await insertChunks('操作の記録', auditRows, (c) => db.insert(auditLogs).values(c));

  // 回：天候中止の印と、予約済みの人数
  if (weatherSlots.size > 0) {
    await db
      .update(slots)
      .set({ status: 'weather_cancelled' })
      .where(inArray(slots.id, [...weatherSlots]));
  }
  await db.execute(sql`
    update slots s set reserved_count = coalesce((
      select sum(b.party_size) from bookings b
      where b.slot_id = s.id and b.status not in ('cancelled', 'weather_cancelled')
    ), 0)
    where s.menu_id in (${sql.join(
      planMenus.map((m) => sql`${m.id}`),
      sql`, `,
    )})
  `);

  await seedInquiries(shop.id, now, adminId);
  await seedApplications(shop.id, now);
  // 実際の予約（デモでない予約）があれば、精算は作らない（精算は組合全体の予約で作るため、実際の予約まで振込済みにしてしまう）
  const [real] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.shopId, shop.id), sql`coalesce(${bookings.contactEmail}, '') not like 'demo+%@example.com'`))
    .limit(1);
  if (real) {
    console.info('実際の予約があるため、精算は作りません');
    console.info('デモのデータを作りました');
    return;
  }
  await seedSettlements({
    shopId: shop.id,
    tz,
    adminId,
    now,
    startMonth,
    payoutDay: settings.payoutDay,
    invoiceNumber: settings.invoiceNumber,
  });
  console.info('デモのデータを作りました');
}

/** お問い合わせ（済んだもの・対応中・未対応） */
async function seedInquiries(shopId: string, now: Date, adminId: string) {
  const samples = [
    ['booking', '予約の日時を変えたい', '来週のパラセーリングの予約ですが、午後の回に変えられますか。'],
    ['booking', '雨の場合について', '小雨でも実施しますか？中止の連絡はいつ来ますか。'],
    [
      'group',
      '社員旅行での利用',
      '30名ほどの社員旅行で、マリンスポーツをまとめて予約したいです。見積もりをお願いします。',
    ],
    ['group', '修学旅行の体験学習', '高校の修学旅行（約120名）で、体験学習として利用できるか相談させてください。'],
    [
      'partner',
      '組合への加入について',
      '宜野湾でSUPのツアーをしています。組合のサイトに掲載していただく条件を教えてください。',
    ],
    ['other', '駐車場について', 'マリーナの駐車場は無料ですか。何台くらい停められますか。'],
    ['other', '領収書の宛名', '会社名で領収書を出していただけますか。'],
    ['booking', '子供の年齢', '5歳の子供もフライボードを見学できますか。'],
  ] as const;
  const rows: (typeof inquiries.$inferInsert)[] = [];
  for (let i = 0; i < 64; i++) {
    const [kind, , message] = pick(samples);
    const at = new Date(now.getTime() - between(0.2, 365) * DAY);
    const age = (now.getTime() - at.getTime()) / DAY;
    const status =
      age > 7
        ? 'done'
        : age > 2
          ? weighted([
              ['done', 2],
              ['in_progress', 1],
            ] as const)
          : weighted([
              ['new', 2],
              ['in_progress', 1],
            ] as const);
    rows.push({
      shopId,
      kind,
      name: `${pick(FAMILY)} ${pick(GIVEN)}`,
      email: `demo+inq${String(i + 1).padStart(3, '0')}@example.com`,
      phone: chance(0.6) ? `+819000${String(100000 + Math.floor(rand() * 899999))}` : null,
      message,
      status,
      consentedAt: at,
      note: status === 'done' ? 'メールで回答済み（デモ）' : '',
      handledBy: status === 'new' ? null : adminId,
      createdAt: at,
      updatedAt: status === 'new' ? at : new Date(at.getTime() + between(1, 30) * HOUR),
    });
  }
  await insertChunks('お問い合わせ', rows, (c) => db.insert(inquiries).values(c));
}

/** 事業者の登録申請（新着・確認中・見送り） */
async function seedApplications(shopId: string, now: Date) {
  const samples = [
    { status: 'new', company: '北谷サンセットSUP（デモ）', days: 1 },
    { status: 'reviewing', company: '那覇ブルーダイブ（デモ）', days: 6 },
    { status: 'rejected', company: '恩納マリンサービス（デモ）', days: 75 },
  ] as const;
  const rows = samples.map((s, i) => {
    const at = new Date(now.getTime() - s.days * DAY);
    return {
      shopId,
      status: s.status,
      companyName: s.company,
      address: '沖縄県宜野湾市真志喜（デモ）',
      representative: `${pick(FAMILY)} ${pick(GIVEN)}`,
      contactName: `${pick(FAMILY)} ${pick(GIVEN)}`,
      phone: `+819000${String(100000 + Math.floor(rand() * 899999))}`,
      email: `demo+app${i + 1}@example.com`,
      planInfo: 'SUP・シュノーケルのツアー（所要 2 時間、定員 8 名、大人 6,000 円）',
      message: '組合のサイトへの掲載を希望します。（デモ）',
      consentedAt: at,
      reviewNote: s.status === 'rejected' ? '必要な保険の書類がそろわなかったため（デモ）' : '',
      reviewedAt: s.status === 'rejected' ? new Date(at.getTime() + 5 * DAY) : null,
      createdAt: at,
      updatedAt: at,
    } satisfies typeof operatorApplications.$inferInsert;
  });
  await insertChunks('登録申請', rows, (c) => db.insert(operatorApplications).values(c));
}

/**
 * 月次の精算：締めた月ごとに下書きを作り（アプリの計算そのまま）、先月より前は確定・振込済みにする。
 * 確定・振込の日時は、その月の翌月の日付で残す
 */
async function seedSettlements(p: {
  shopId: string;
  tz: string;
  adminId: string;
  now: Date;
  startMonth: string;
  payoutDay: number;
  invoiceNumber: string;
}) {
  const lastMonth = addMonths(monthOf(localDate(p.now, p.tz)), -1);
  for (let period = p.startMonth; period <= lastMonth; period = addMonths(period, 1)) {
    await buildSettlements(db, { shopId: p.shopId, period, actorId: p.adminId, now: p.now });
    if (period === lastMonth) continue;
    const rows = await db
      .select()
      .from(settlements)
      .where(and(eq(settlements.shopId, p.shopId), eq(settlements.period, period), eq(settlements.status, 'draft')));
    const next = addMonths(period, 1);
    const confirmedAt = zonedToUtc(`${next}-05`, '10:00', p.tz);
    const payoutOn = payoutDateOf(period, p.payoutDay);
    const paidAt = zonedToUtc(payoutOn, '11:00', p.tz);
    for (const row of rows) {
      await db
        .update(settlements)
        .set({
          status: 'paid',
          confirmedAt,
          confirmedBy: p.adminId,
          payoutOn,
          shopInvoiceNumber: p.invoiceNumber,
          paidAt,
          paidBy: p.adminId,
          paidNote: '振込済み（デモ）',
          updatedAt: paidAt,
        })
        .where(eq(settlements.id, row.id));
      const items = await db
        .select({ bookingId: settlementItems.bookingId })
        .from(settlementItems)
        .innerJoin(bookings, eq(bookings.id, settlementItems.bookingId))
        .where(and(eq(settlementItems.settlementId, row.id), eq(bookings.status, 'verified')));
      const ids = items.map((i) => i.bookingId);
      if (ids.length > 0) {
        await db.update(bookings).set({ status: 'settled', updatedAt: paidAt }).where(inArray(bookings.id, ids));
        await db.insert(bookingStatusEvents).values(
          ids.map((bookingId) => ({
            bookingId,
            fromStatus: 'verified' as const,
            toStatus: 'settled' as const,
            actorType: 'staff' as const,
            actorId: p.adminId,
            note: `月次精算（${period}）の振込を記録`,
            createdAt: paidAt,
          })),
        );
      }
      await db.insert(auditLogs).values([
        {
          shopId: p.shopId,
          actorId: p.adminId,
          action: 'settlement.confirm',
          targetType: 'settlement',
          targetId: row.id,
          after: { payoutAmount: row.payoutAmount, payoutOn, demo: true },
          createdAt: confirmedAt,
        },
        {
          shopId: p.shopId,
          actorId: p.adminId,
          action: 'settlement.paid',
          targetType: 'settlement',
          targetId: row.id,
          after: { paidAt: paidAt.toISOString(), payoutAmount: row.payoutAmount, note: '振込済み（デモ）' },
          createdAt: paidAt,
        },
      ]);
    }
    console.info(`  精算 ${period}：${rows.length} 件を振込済みに`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
