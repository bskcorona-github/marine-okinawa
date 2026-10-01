/**
 * 協同組合のサイトの初期データを作る。tagoo.jp から抽出した宜野湾港マリーナのコンテンツ
 * （docs/content/ginowan-marina.json）から、初期 5 メニューのうち原稿のあるもの（パラセーリング・フライボード）を
 * 公開し、原稿待ちの 3 メニューを下書きで作る。
 *   npm run import:ginowan
 * - 先に npm run seed でショップと管理者を作っておくこと
 * - slug をキーに冪等（事業者・メニューは上書き更新、料金区分・回のルール・オン期は置き換え）
 * - 画像は取り込まない（運営者が用意したものを管理画面から登録する）。既に登録済みの画像は変更しない
 */
import { readFileSync } from 'node:fs';
import { and, eq, isNull, like, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  activities,
  menuImages,
  menuPrices,
  menus,
  menuTranslations,
  operators,
  scheduleRules,
  seasonPeriods,
  shops,
  type ItineraryStep,
  type ShopProfile,
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
  /** 出発港が複数ある貸切などの、港ごとの集合場所 */
  meetingPoints?: { label: string | null; text: string; parking?: string | null }[];
  whatToBring: string | null;
  included: string | null;
  notes: string | null;
  cancellationPolicy: string | null;
  schedule: { title: string; text: string; image?: string | null }[] | null;
  images: string[];
};

/** 料金区分名（例：「貸切基本料金（10名様迄）那覇市三重城港発」）に合う港の集合場所。1 か所だけなら使わない */
function meetingPointForPrice(label: string, points: SourcePlan['meetingPoints']): string | null {
  if (!points || points.length < 2) return null;
  const place = PORT_KEYWORDS.find((k) => label.includes(k));
  const point = place ? points.find((p) => p.text.includes(place)) : undefined;
  if (!point) return null;
  return point.parking ? `${point.text}\n駐車場：${point.parking}` : point.text;
}

const PORT_KEYWORDS = ['宜野湾', '三重城', '北谷'];

/**
 * 1 回の予約で申し込める人数。「お申し込み人数」の「2～」「1～10」を読み、上限がなければ回の定員まで。
 * 貸切は 1 回 = 1 艇（乗船人数の上限は maxGuests で別に持つ）
 */
function partySizeRange(plan: SourcePlan, isCharter: boolean): { minPartySize: number; maxPartySize: number } {
  if (isCharter) return { minPartySize: 1, maxPartySize: 1 };
  const m = /^\s*(\d+)\s*[～~〜]\s*(\d+)?/.exec(plan.applicationPartySizeText ?? '');
  const min = m ? Number(m[1]) : 1;
  const max = m?.[2] ? Number(m[2]) : (plan.capacity ?? 10);
  return { minPartySize: Math.max(1, min), maxPartySize: Math.max(min, max) };
}

/** 貸切の「基本料金（10名様迄）」と「11名以上 追加」のオプションから、基本人数と追加料金を読む */
function charterGuestPricing(plan: SourcePlan): { includedGuests: number | null; extraGuestPrice: number | null } {
  const included = plan.prices.map((p) => /（(\d+)名様迄）/.exec(p.label)?.[1]).find(Boolean);
  const extra = (plan.options ?? []).find((o) => /\d+名以上\s*追加/.test(o.label))?.price ?? null;
  return { includedGuests: included ? Number(included) : null, extraGuestPrice: included ? extra : null };
}

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

/** 元ページの誤字（取り込むときに直す） */
const TYPO_FIXES: [RegExp, string][] = [
  [/プレザント/g, 'プレゼント'],
  [/セッテング/g, 'セッティング'],
  [/広がリ/g, '広がり'],
  // 表記をサイトの文体（公用文の書き方）にそろえる
  [/下さい/g, 'ください'],
  [/頂き/g, 'いただき'],
  [/頂いて/g, 'いただいて'],
  [/早目/g, '早め'],
];

/**
 * 組合のサイトとして載せるため、事業者の立場で書かれた言い回しを直す
 * （「当店」「お任せください」など、特定の事業者を前に出す表現）
 */
const VOICE_FIXES: [RegExp, string][] = [
  [/当店完全オーダーメイドの/g, ''],
  [/当店/g, '実施事業者'],
  [/今話題のフライボードならお任せください！/g, '今話題のフライボードを体験できます。'],
  [
    /お客様都合によるキャンセル・変更は早めにご連絡ください。/g,
    'お客様のご都合によるキャンセル・変更は、お早めに組合へご連絡ください。',
  ],
];

/**
 * 持ち物（元ページにない）。マリンアクティビティで一般的なものを下書きとして入れる
 * （組合・実施事業者に確認して直す前提。README の「取り込み後に確認すること」に記載）
 */
const DEFAULT_WHAT_TO_BRING = [
  '水着（服の下に着てお越しください）',
  'タオル',
  '着替え',
  '日焼け止め・サングラス（必要な方）',
].join('\n');

/** 元ページの「オン期／オフ期」を、サイトの料金表の呼び方（繁忙期／通常期）にそろえる */
function seasonWords(text: string | null | undefined): string {
  return (text ?? '').replace(/オン期/g, '繁忙期').replace(/オフ期/g, '通常期');
}

/** 誤字を直し、全角の英数字（「１５０ｍ」など）を半角にそろえる。全角の記号・かっこはそのまま残す */
function fixTypos(text: string): string {
  return (
    [...TYPO_FIXES, ...VOICE_FIXES]
      .reduce((acc, [pattern, fixed]) => acc.replace(pattern, fixed), text)
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => ch.normalize('NFKC'))
      // 半角カナ（「ｸﾞﾙｰﾌﾟ」など）を全角にそろえる
      .replace(/[\uFF61-\uFF9F]+/g, (run) => run.normalize('NFKC'))
  );
}

/** tagoo（「沖縄の遊び」）固有の案内文を取り除く */
function cleanText(text: string | null | undefined): string {
  if (!text) return '';
  return fixTypos(text)
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
function splitSeason(label: string): { label: string; season: 'on' | 'off' | null } {
  // 「1名」だけの区分名は人数の入力欄と紛らわしいので「参加者」にする（1 名あたりの料金として表示する）
  const tidy = (s: string) => (s.trim() === '1名' ? '参加者' : s.trim());
  if (label.includes('（オン期）')) return { label: tidy(label.replace('（オン期）', '')), season: 'on' };
  if (label.includes('（オフ期）')) return { label: tidy(label.replace('（オフ期）', '')), season: 'off' };
  return { label: tidy(label), season: null };
}

function joinSections(...sections: [string, string | null | undefined][]): string {
  return sections
    .map(([heading, body]) => [heading, cleanText(body)] as const)
    .filter(([, body]) => body)
    .map(([heading, body]) => (heading ? `【${heading}】\n${body}` : body))
    .join('\n\n');
}

/** 元ページから保存していた画像の置き場所（ファイルは削除済み。組合が用意した写真を登録する） */
const OLD_IMAGE_PREFIX = '/content/ginowan/';

/** 組合のサイトとして最初に公開する 5 メニューのアクティビティ（並び順どおり） */
const ACTIVITIES = [
  {
    slug: 'parasailing',
    name: 'パラセーリング',
    category: 'parasailing' as const,
    lead: 'パラシュートで宜野湾の空へ。海と空を一度に楽しめる、沖縄のマリンスポーツの定番です。',
  },
  {
    slug: 'flyboard',
    name: 'フライボード',
    category: 'marine_sports' as const,
    lead: '水の噴射で海の上に浮かび上がる、話題のマリンアクティビティです。',
  },
  {
    slug: 'trial-diving',
    name: '体験ダイビング',
    category: 'diving' as const,
    lead: '初めての方も、インストラクターと一緒に沖縄の海の中を体験できます。',
  },
  {
    slug: 'marine-sports',
    name: 'マリンスポーツ',
    category: 'marine_sports' as const,
    lead: 'バナナボートなど、みんなで盛り上がれるマリンスポーツのセットプランです。',
  },
  {
    slug: 'boat-snorkeling',
    name: 'ボートシュノーケリング',
    category: 'snorkeling' as const,
    lead: 'ボートで沖のポイントへ。集合場所と所要時間を確かめて参加できます。',
  },
];

/** パラセーリングは高さ違いの 3 プランを 1 プランにまとめ、高さを料金区分にする（同じ船・同じ時刻のため） */
const PARASAILING_HEIGHTS: [slug: string, label: string][] = [
  ['ginowan-parasailing-100m', '高さ100m'],
  ['ginowan-parasailing-150m', '高さ150m'],
  ['ginowan-parasailing-200m', '高さ200m（県内最長）'],
];

/** 元データから公開するプラン（それ以外の移植済みプランはアーカイブにする） */
const PUBLISH: { source: string; slug: string; activity: string; featured: boolean }[] = [
  { source: 'merged-parasailing', slug: 'ginowan-parasailing', activity: 'parasailing', featured: true },
  { source: 'ginowan-flyboard', slug: 'ginowan-flyboard', activity: 'flyboard', featured: true },
];

/** 原稿・料金が届いていないメニュー（下書きで作り、内容は管理画面で入れる） */
const DRAFTS = [
  {
    slug: 'ginowan-trial-diving',
    activity: 'trial-diving',
    category: 'diving' as const,
    title: '体験ダイビング（原稿準備中）',
    summary: '初めての方向けの体験ダイビングです。内容・料金・写真は準備中です。',
  },
  {
    slug: 'ginowan-marine-sports-2',
    activity: 'marine-sports',
    category: 'marine_sports' as const,
    title: 'マリンスポーツ2種セット（原稿準備中）',
    summary: 'バナナボート・マーブル・ビスケットなどから2種類を楽しめるセットです。セット内容・料金は準備中です。',
  },
  {
    slug: 'ginowan-boat-snorkeling',
    activity: 'boat-snorkeling',
    category: 'snorkeling' as const,
    title: 'ボートシュノーケリング（原稿準備中）',
    summary: 'ボートで沖のポイントへ行くシュノーケリングです。集合場所・所要時間・料金は準備中です。',
  },
];

/** 説明文から、当日の流れ（別の欄に出す）と、高さ変更の案内（プランをまとめたので不要）を除く */
function tidyDescription(text: string): string {
  return cleanText(text)
    .replace(/＜当日の流れ＞[\s\S]*$/, '')
    .split('\n')
    .filter((line) => !/^※オプションで当日にロープ/.test(line))
    .join('\n')
    .trim();
}

/** 高さ違いの 3 プランから、まとめたパラセーリングのプランを作る（本文は 150m を元にする） */
function mergedParasailing(): SourcePlan {
  const bySlug = new Map(source.plans.map((p) => [p.slug, p]));
  const base = bySlug.get('ginowan-parasailing-150m');
  if (!base) throw new Error('parasailing 150m is missing in the source');
  const prices = PARASAILING_HEIGHTS.flatMap(([slug, height]) =>
    (bySlug.get(slug)?.prices ?? []).map((p) => ({
      label: p.label.replace(/^1名/, height),
      price: p.price,
    })),
  );
  return {
    ...base,
    slug: 'ginowan-parasailing',
    title: '【宜野湾発】パラセーリング（高さ100m・150m・200mから選べる）★GoPro無料レンタル＆データプレゼント',
    summary:
      '専用ボートから宜野湾の大空へ。高さは、お子様にも人気の100m、絶景の150m、県内最長の200mから選べます。船内にはトイレも完備。',
    description: (base.description ?? '').replace(
      /強者集まれ！高さ150ｍのパラセーリング/,
      '高さは100m・150m・200m（県内最長）から選べます！',
    ),
    schedule: (base.schedule ?? []).map((s) => ({ ...s, text: s.text.replace('上空150ｍへ', '選んだ高さの上空へ') })),
    prices,
  };
}

async function main() {
  const shop = await getCurrentShop(db);
  const today = localDate(new Date(), shop.timezone);
  const marinaAddress = fixTypos(source.shop.access.address);

  // ショップ＝サイトの運営者（組合）。宜野湾港マリーナのアクセス情報は、プランの集合場所へ移す。
  // 管理画面で入力した電話番号・メールアドレス・受付時間・紹介文は残す
  const MARINA_KEYS = [
    'heading',
    'catchCopy',
    'areaLabel',
    'directions',
    'parking',
    'landmark',
    'mapEmbedUrl',
    'mapLinkUrl',
    'nearbyHotels',
  ];
  const kept = Object.fromEntries(
    Object.entries(shop.profile).filter(
      // 元ページから保存していた画像（public/content/ginowan/）は削除したので、参照も外す
      ([key, value]) =>
        !MARINA_KEYS.includes(key) && !(key === 'heroImage' && String(value).startsWith(OLD_IMAGE_PREFIX)),
    ),
  ) as ShopProfile;
  await db.delete(menuImages).where(like(menuImages.url, `${OLD_IMAGE_PREFIX}%`));
  await db
    .update(operators)
    .set({ images: [] })
    .where(
      sql`exists (select 1 from unnest(${operators.images}) as u(url) where u.url like ${`${OLD_IMAGE_PREFIX}%`})`,
    );
  await db
    .update(shops)
    .set({
      name: '沖縄県マリンレジャー事業協同組合',
      profile: {
        ...kept,
        address: kept.address === source.shop.access.address ? '' : (kept.address ?? ''),
        introduction:
          kept.introduction && kept.introduction !== source.shop.introduction
            ? kept.introduction
            : '沖縄県マリンレジャー事業協同組合は、沖縄のマリンレジャー事業者が集まる協同組合です。このサイトでは、組合が確認した事業者のアクティビティを、組合がひとつの窓口となってご案内・ご予約を承ります。まずは宜野湾港マリーナ周辺のアクティビティから始め、地域とアクティビティを広げていきます。',
      },
    })
    .where(eq(shops.id, shop.id));

  // アクティビティ
  const activityIds = new Map<string, string>();
  for (const [index, a] of ACTIVITIES.entries()) {
    const values = {
      shopId: shop.id,
      slug: a.slug,
      name: a.name,
      lead: a.lead,
      category: a.category,
      sortOrder: index,
    };
    const [row] = await db
      .insert(activities)
      .values(values)
      // 管理画面で直した紹介文は上書きしない（名前と並び順だけそろえる）
      .onConflictDoUpdate({ target: [activities.shopId, activities.slug], set: { sortOrder: index } })
      .returning({ id: activities.id });
    activityIds.set(a.slug, row.id);
  }

  // 事業者
  const operatorIds = new Map<string, string>();
  for (const [index, op] of source.shop.operators.entries()) {
    const firstPlan = source.plans.find((p) => p.operatorSlug === op.slug);
    const values = {
      shopId: shop.id,
      slug: op.slug,
      name: op.name,
      about: op.about,
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
  // 初期の実施体制に入る事業者（連絡先などは管理画面で登録する）
  await db
    .insert(operators)
    .values({ shopId: shop.id, slug: 'aquamarine', name: 'アクアマリン', sortOrder: source.shop.operators.length })
    .onConflictDoNothing();

  // 公開するプラン
  const sources = new Map<string, SourcePlan>([
    ['merged-parasailing', mergedParasailing()],
    ...source.plans.map((p) => [p.slug, p] as [string, SourcePlan]),
  ]);
  const keep = new Set<string>();
  for (const target of PUBLISH) {
    const plan = sources.get(target.source);
    if (!plan) throw new Error(`source plan not found: ${target.source}`);
    await importPlan(plan, {
      shopId: shop.id,
      timezone: shop.timezone,
      today,
      operatorId: operatorIds.get(plan.operatorSlug) ?? null,
      activityId: activityIds.get(target.activity) ?? null,
      featured: target.featured,
      meetingAddress: marinaAddress,
    });
    keep.add(target.slug);
  }

  // 原稿待ちの下書き（既にあれば、管理画面で入れた内容を消さないよう何もしない）
  for (const draft of DRAFTS) {
    keep.add(draft.slug);
    const [existing] = await db
      .select({ id: menus.id })
      .from(menus)
      .where(and(eq(menus.shopId, shop.id), eq(menus.slug, draft.slug)));
    if (existing) continue;
    const [menu] = await db
      .insert(menus)
      .values({
        shopId: shop.id,
        slug: draft.slug,
        status: 'draft',
        category: draft.category,
        durationMin: 60,
        activityId: activityIds.get(draft.activity) ?? null,
        cutoffPrevDayTime: '18:00',
      })
      .returning({ id: menus.id });
    await db.insert(menuTranslations).values({
      menuId: menu.id,
      locale: 'ja',
      title: draft.title,
      summary: draft.summary,
      meetingAddress: marinaAddress,
    });
    console.info(`draft: ${draft.slug}`);
  }

  // それ以外（高さ別のパラセーリング・釣り・貸切・ホエールウォッチングなど）はアーカイブにする（過去の予約は残る）
  const all = await db.select({ id: menus.id, slug: menus.slug }).from(menus).where(eq(menus.shopId, shop.id));
  for (const m of all) {
    if (!keep.has(m.slug)) {
      await db.update(menus).set({ status: 'archived', featured: false }).where(eq(menus.id, m.id));
      console.info(`archived: ${m.slug}`);
    }
  }
}

/** 元データの 1 プランを取り込む（slug で上書き。料金区分・回のルールは置き換える） */
async function importPlan(
  plan: SourcePlan,
  ctx: {
    shopId: string;
    timezone: string;
    today: string;
    operatorId: string | null;
    activityId: string | null;
    featured: boolean;
    meetingAddress: string;
  },
) {
  const category = categoryOf(plan.slug);
  const isCharter = category === 'cruise';
  const isWhale = category === 'whale_watching';
  const menuValues = {
    shopId: ctx.shopId,
    slug: plan.slug,
    status: 'published' as const,
    category,
    durationMin: plan.durationMin ?? 60,
    minAge: plan.minAge,
    // 貸切は 1 回 = 1 艇
    ...partySizeRange(plan, isCharter),
    bookingCutoffMin: 120,
    cutoffPrevDayTime: prevDayDeadline(source.policies.bookingDeadline[deadlineKey(plan)]),
    operatorId: ctx.operatorId,
    activityId: ctx.activityId,
    featured: ctx.featured,
    capacityUnit: isCharter ? '艇' : '名',
    ...(isCharter
      ? { ...charterGuestPricing(plan), maxGuests: plan.capacity }
      : { includedGuests: null, extraGuestPrice: null, maxGuests: null }),
  };
  const [menu] = await db
    .insert(menus)
    .values({ ...menuValues, publishedAt: new Date() })
    .onConflictDoUpdate({
      target: [menus.shopId, menus.slug],
      // 公開日時は最初の取り込みのまま（「新着」の並びを変えない）
      set: menuValues,
    })
    .returning({ id: menus.id });

  const itinerary: ItineraryStep[] = (plan.schedule ?? []).map((s) => ({
    title: fixTypos(s.title),
    text: fixTypos(s.text),
    image: null,
  }));
  const onsiteOptions: OnsiteOption[] = (plan.options ?? []).map((o) => ({
    label: o.unit ? `${o.label}（1${o.unit}あたり）` : o.label,
    price: o.price ?? null,
    durationMin: o.durationMin ?? null,
    note: o.note ?? null,
  }));
  const translation = {
    title: fixTypos(plan.title),
    summary: fixTypos(plan.summary ?? ''),
    description: tidyDescription(plan.description ?? ''),
    meetingPoint: fixTypos(plan.meetingPoint ?? '').replace(/（住所：[^）]*）/, ''),
    meetingAddress: ctx.meetingAddress,
    whatToBring: fixTypos(plan.whatToBring ?? '') || DEFAULT_WHAT_TO_BRING,
    included: fixTypos(plan.included ?? '').replace(/、/g, '\n'),
    // 申し込める人数は要点（1回のご予約の人数）に出すので、参加条件には重ねない
    conditions: joinSections(['', plan.participationConditions]),
    // 料金表の呼び方（繁忙期／通常期）にそろえる
    notes: joinSections(['料金について', seasonWords(plan.priceNotes)], ['', plan.notes]),
    cancellationPolicy: cleanText(plan.cancellationPolicy),
    weatherPolicy: cleanText(source.policies.weather[deadlineKey(plan)]),
    itinerary,
    onsiteOptions,
  };
  // 翻訳・料金区分・回のルールは途中で失敗しても中途半端にならないよう 1 トランザクションで置き換える
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
        meetingPoint: meetingPointForPrice(p.label, plan.meetingPoints),
        sortOrder: i,
      })),
    );

    // 回のルール
    await tx.delete(scheduleRules).where(eq(scheduleRules.menuId, menu.id));
    const times = isCharter ? ['09:00'] : plan.startTimes;
    const capacity = isCharter ? 1 : (plan.capacity ?? 10);
    // ホエールウォッチングは冬季（1/4〜3/30）のみ。元ページは 2026 年の表記のため次のシーズンで作る
    const whaleYear = Number(ctx.today.slice(0, 4)) + (ctx.today.slice(5) > '03-30' ? 1 : 0);
    await tx.insert(scheduleRules).values(
      times.map((startTime) => ({
        menuId: menu.id,
        validFrom: isWhale ? `${whaleYear}-01-04` : ctx.today,
        validTo: isWhale ? `${whaleYear}-03-30` : null,
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        startTime,
        capacity,
      })),
    );
  });
  const result = await resyncMenu(db, { menuId: menu.id, timezone: ctx.timezone, now: new Date() });
  console.info(`menu: ${plan.slug} (${category}) slots +${result.inserted} ~${result.updated} -${result.deleted}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
