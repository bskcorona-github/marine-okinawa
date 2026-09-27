/**
 * tagoo.jp から抽出した宜野湾港マリーナのコンテンツ（docs/content/ginowan-marina.json）を取り込む。
 *   npm run import:ginowan
 * - 先に npm run seed でショップと管理者を作っておくこと
 * - slug をキーに冪等（事業者・メニューは上書き更新、料金区分・画像・回のルール・オン期は置き換え）
 * - 画像は public/content/ginowan/ にダウンロード済みのものを使う
 */
import { readFileSync } from 'node:fs';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import {
  menuImages,
  menuPrices,
  menus,
  menuTranslations,
  operators,
  scheduleRules,
  seasonPeriods,
  shops,
  type ItineraryStep,
  type OnsiteOption,
} from '@/db/schema';
import { localDate } from '@/lib/dates';
import { parseSeasonText } from '@/modules/catalog/season';
import { resyncMenu } from '@/modules/schedule/sync-slots';
import { getCurrentShop } from '@/modules/shop/shops';

type SourcePlan = {
  slug: string;
  title: string;
  operatorSlug: string;
  summary: string | null;
  description: string | null;
  durationMin: number | null;
  startTimes: string[];
  season: string | null;
  prices: { label: string; price: number }[];
  priceNotes: string | null;
  options:
    | {
        label: string;
        price?: number | null;
        durationMin?: number | null;
        note?: string | null;
        unit?: string;
      }[]
    | null;
  minAge: number | null;
  participationConditions: string | null;
  capacity: number | null;
  applicationPartySizeText: string | null;
  meetingPoint: string | null;
  whatToBring: string | null;
  included: string | null;
  notes: string | null;
  cancellationPolicy: string | null;
  schedule: { title: string; text: string; image?: string | null }[] | null;
  images: string[];
};

type Source = {
  shop: {
    name: string;
    heading: string;
    catchCopy: string;
    introduction: string;
    areaLabel: string;
    access: {
      address: string;
      mapEmbed: string;
      mapLink: string;
      directions: string[];
      parking: string;
      nearbyHotels: string[];
      landmark: string;
    };
    operators: {
      slug: string;
      name: string;
      about: string;
      images: string[];
      onOffSeason?: string;
    }[];
  };
  plans: SourcePlan[];
  policies: {
    bookingDeadline: Record<string, string>;
    weather: Record<string, string>;
  };
  images: { hero: string };
};

const source = JSON.parse(readFileSync('docs/content/ginowan-marina.json', 'utf8')) as Source;

/** tagoo.jp の画像 URL → 自サイトに保存したパス */
function localImage(url: string | null | undefined): string | null {
  if (!url) return null;
  return `/content/ginowan/${url.split('/').pop()!.toLowerCase()}`;
}

/** tagoo（「沖縄の遊び」）固有の案内文を取り除く */
function cleanText(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .split('\n')
    .filter((line) => !/リクエスト|沖縄の遊び|お申し込みは前日/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function categoryOf(slug: string) {
  if (slug.includes('parasailing')) return 'parasailing' as const;
  if (slug.includes('flyboard') || slug.includes('marine-pack')) return 'marine_sports' as const;
  if (slug.includes('fishing')) return 'fishing' as const;
  if (slug.includes('charter')) return 'cruise' as const;
  if (slug.includes('whale')) return 'whale_watching' as const;
  return 'other' as const;
}

function deadlineKey(plan: SourcePlan): string {
  if (plan.operatorSlug !== 'seaworks') return plan.operatorSlug;
  return plan.slug.includes('whale') ? 'seaworks_whale' : 'seaworks_charter';
}

/** 「※お申し込みは前日の18：00まで」→ 18:00 */
function prevDayDeadline(text: string | undefined): string | null {
  const m = text?.match(/前日の?\s*(\d{1,2})[:：](\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

/** 「大人・子供共通（オン期）」→ { label: 大人・子供共通, season: on } */
function splitSeason(label: string): {
  label: string;
  season: 'on' | 'off' | null;
} {
  if (label.includes('（オン期）')) return { label: label.replace('（オン期）', '').trim(), season: 'on' };
  if (label.includes('（オフ期）')) return { label: label.replace('（オフ期）', '').trim(), season: 'off' };
  return { label, season: null };
}

function joinSections(...sections: [string, string | null | undefined][]): string {
  return sections
    .map(([heading, body]) => [heading, cleanText(body)] as const)
    .filter(([, body]) => body)
    .map(([heading, body]) => (heading ? `【${heading}】\n${body}` : body))
    .join('\n\n');
}

async function main() {
  const shop = await getCurrentShop(db);
  const today = localDate(new Date(), shop.timezone);
  const access = source.shop.access;

  await db
    .update(shops)
    .set({
      name: source.shop.name,
      profile: {
        heading: source.shop.heading,
        catchCopy: source.shop.catchCopy,
        introduction: source.shop.introduction,
        heroImage: localImage(source.images.hero) ?? undefined,
        areaLabel: source.shop.areaLabel,
        address: access.address,
        directions: access.directions,
        parking: access.parking.replace(/\s+/g, ' '),
        landmark: access.landmark,
        mapEmbedUrl: access.mapEmbed,
        mapLinkUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(access.address)}`,
        nearbyHotels: access.nearbyHotels,
      },
    })
    .where(eq(shops.id, shop.id));

  // 事業者
  const operatorIds = new Map<string, string>();
  for (const [index, op] of source.shop.operators.entries()) {
    const firstPlan = source.plans.find((p) => p.operatorSlug === op.slug);
    const values = {
      shopId: shop.id,
      slug: op.slug,
      name: op.name,
      about: op.about,
      images: op.images.map((u) => localImage(u)!),
      bookingDeadlineNote: firstPlan ? cleanText(source.policies.bookingDeadline[deadlineKey(firstPlan)]) : '',
      cancellationPolicy: firstPlan?.cancellationPolicy ?? '',
      weatherPolicy: firstPlan ? (source.policies.weather[deadlineKey(firstPlan)] ?? '') : '',
      sortOrder: index,
    };
    const [row] = await db
      .insert(operators)
      .values(values)
      .onConflictDoUpdate({
        target: [operators.shopId, operators.slug],
        set: values,
      })
      .returning({ id: operators.id });
    operatorIds.set(op.slug, row.id);

    // オン期（ココマリンのみ）
    await db.delete(seasonPeriods).where(eq(seasonPeriods.operatorId, row.id));
    if (op.onOffSeason) {
      const onLine = op.onOffSeason.split('\n').find((l) => l.startsWith('オン期')) ?? '';
      const year = Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < 4 ? 1 : 0);
      const periods = parseSeasonText(onLine, { year, startMonth: 4 });
      if (periods.length > 0) await db.insert(seasonPeriods).values(periods.map((p) => ({ operatorId: row.id, ...p })));
      console.info(`season: ${op.slug} ${periods.length} periods`);
    }
  }

  // メニュー
  for (const plan of source.plans) {
    const category = categoryOf(plan.slug);
    const isCharter = category === 'cruise';
    const isWhale = category === 'whale_watching';
    const operatorId = operatorIds.get(plan.operatorSlug) ?? null;

    const menuValues = {
      shopId: shop.id,
      slug: plan.slug,
      status: 'published' as const,
      category,
      durationMin: plan.durationMin ?? 60,
      minAge: plan.minAge,
      // 貸切は 1 回 = 1 艇
      maxPartySize: isCharter ? 1 : Math.min(plan.capacity ?? 10, 10),
      bookingCutoffMin: 120,
      cutoffPrevDayTime: prevDayDeadline(source.policies.bookingDeadline[deadlineKey(plan)]),
      operatorId,
      capacityUnit: isCharter ? '艇' : '名',
    };
    const [menu] = await db
      .insert(menus)
      .values(menuValues)
      .onConflictDoUpdate({
        target: [menus.shopId, menus.slug],
        set: menuValues,
      })
      .returning({ id: menus.id });

    const itinerary: ItineraryStep[] = (plan.schedule ?? []).map((s) => ({
      title: s.title,
      text: s.text,
      image: localImage(s.image),
    }));
    const onsiteOptions: OnsiteOption[] = (plan.options ?? []).map((o) => ({
      label: o.unit ? `${o.label}（1${o.unit}あたり）` : o.label,
      price: o.price ?? null,
      durationMin: o.durationMin ?? null,
      note: o.note ?? null,
    }));
    const translation = {
      title: plan.title,
      summary: plan.summary ?? '',
      description: plan.description ?? '',
      meetingPoint: plan.meetingPoint ?? '',
      whatToBring: plan.whatToBring ?? '',
      included: plan.included ?? '',
      conditions: joinSections(['', plan.participationConditions], ['お申し込み人数', plan.applicationPartySizeText]),
      notes: joinSections(['料金について', plan.priceNotes], ['', plan.notes]),
      itinerary,
      onsiteOptions,
    };
    // 翻訳・料金区分・画像・回のルールは途中で失敗しても中途半端にならないよう 1 トランザクションで置き換える
    await db.transaction(async (tx) => {
      await tx
        .insert(menuTranslations)
        .values({ menuId: menu.id, locale: 'ja', ...translation })
        .onConflictDoUpdate({
          target: [menuTranslations.menuId, menuTranslations.locale],
          set: translation,
        });

      // 料金区分：既存の有効な区分はアーカイブして作り直す（過去の予約明細は残る）
      await tx
        .update(menuPrices)
        .set({ archivedAt: new Date() })
        .where(and(eq(menuPrices.menuId, menu.id), isNull(menuPrices.archivedAt)));
      await tx.insert(menuPrices).values(
        plan.prices.map((p, i) => ({
          menuId: menu.id,
          ...splitSeason(p.label),
          price: p.price,
          sortOrder: i,
        })),
      );

      await tx.delete(menuImages).where(eq(menuImages.menuId, menu.id));
      const images = plan.images.map(localImage).filter((u): u is string => Boolean(u));
      if (images.length > 0) {
        await tx.insert(menuImages).values(
          images.map((url, i) => ({
            menuId: menu.id,
            url,
            alt: plan.title,
            sortOrder: i,
          })),
        );
      }

      // 回のルール
      await tx.delete(scheduleRules).where(eq(scheduleRules.menuId, menu.id));
      const times = isCharter ? ['09:00'] : plan.startTimes;
      const capacity = isCharter ? 1 : (plan.capacity ?? 10);
      // ホエールウォッチングは冬季（1/4〜3/30）のみ。元ページは 2026 年の表記のため次のシーズンで作る
      const whaleYear = Number(today.slice(0, 4)) + (today.slice(5) > '03-30' ? 1 : 0);
      await tx.insert(scheduleRules).values(
        times.map((startTime) => ({
          menuId: menu.id,
          validFrom: isWhale ? `${whaleYear}-01-04` : today,
          validTo: isWhale ? `${whaleYear}-03-30` : null,
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          startTime,
          capacity,
        })),
      );
    });
    const result = await resyncMenu(db, {
      menuId: menu.id,
      timezone: shop.timezone,
      now: new Date(),
    });
    console.info(`menu: ${plan.slug} (${category}) slots +${result.inserted} ~${result.updated} -${result.deleted}`);
  }

  // 取り込み対象外になったサンプルメニューは非公開にする
  const importedSlugs = new Set(source.plans.map((p) => p.slug));
  const all = await db.select({ id: menus.id, slug: menus.slug }).from(menus).where(eq(menus.shopId, shop.id));
  for (const m of all) {
    if (!importedSlugs.has(m.slug)) {
      await db.update(menus).set({ status: 'archived' }).where(eq(menus.id, m.id));
      console.info(`archived: ${m.slug}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
