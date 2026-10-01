import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { DbOrTx } from '@/db/client';
import { sitePages } from '@/db/schema';
import { isOwnKey } from '@/lib/own';

/** 固定ページの URL（slug）とページ名。本文は管理画面で編集し、保存がなければ初期文を出す */
export const SITE_PAGES = {
  guide: '初めての方へ',
  'how-to-book': '予約方法',
  safety: '安全への取組み',
  privacy: 'プライバシーポリシー',
  about: '運営者情報',
} as const;

export type SitePageSlug = keyof typeof SITE_PAGES;

export function isSitePageSlug(value: unknown): value is SitePageSlug {
  return isOwnKey(SITE_PAGES, value);
}

/**
 * 初期文（組合の正式な文面が届くまでの下書き）。「## 見出し」「- 箇条書き」の書式。
 * 事実関係（所在地・連絡先・規定の数字）は書かず、組合に差し替えてもらう前提の一般的な案内だけにする
 */
export const DEFAULT_PAGE_BODIES: Record<SitePageSlug, string> = {
  guide: `沖縄の海が初めての方、マリンアクティビティが初めての方も安心してご参加いただけるよう、よくあるご質問をまとめました。

## 泳げなくても参加できますか
プランによって異なります。各プランの「参加条件」をご確認ください。ライフジャケットを着用するプランが多く、スタッフがサポートします。

## 何を持っていけばいいですか
各プランの「持ち物」をご確認ください。水着・タオル・着替え・日焼け止めがあると安心です。

## 天候が悪いときはどうなりますか
安全のため、天候・海況によって中止になることがあります。中止の基準と、中止のときのお支払いの扱いは、各プランの「天候等による中止」をご確認ください。

## 予約はいつ確定しますか
お申し込みのあと、組合が空き状況と内容を確認し、お支払い方法をご案内します。お支払いを確認した時点で、ご予約が確定します。`,
  'how-to-book': `## 1. プランを選んでお申し込み
アクティビティからプランを選び、ご希望の日時・人数・連絡先を入力してお申し込みください。この時点では、まだご予約は確定していません。

## 2. 組合が内容を確認
組合が空き状況と実施の可否を確認します。ご希望の日時で実施できない場合は、第2希望などをもとにご連絡します。

## 3. お支払い
実施できる場合は、メールでお支払い方法と期限をご案内します。期限までにお支払いください。

## 4. 予約確定
お支払いを確認したら「予約確定」のメールをお送りします。実施する事業者・集合場所・当日の連絡先をご案内します。

## 5. 当日
集合時刻までに集合場所へお越しください。受付で予約番号をお伝えください。`,
  safety: `沖縄県マリンレジャー事業協同組合は、組合員の事業者とともに、安全にマリンアクティビティを楽しんでいただくための取組みを進めています。

## 事業者の確認
掲載する事業者は、必要な保険・許認可を確認しています。

## 天候・海況の判断
当日の天候・海況を確認し、安全に実施できない場合は中止します。

## 参加条件の確認
年齢・健康状態など、プランごとの参加条件をお申し込みの前にご確認いただいています。`,
  privacy: `沖縄県マリンレジャー事業協同組合（以下「組合」）は、お申し込み・お問い合わせでお預かりする個人情報を、以下のとおり取り扱います。

## 利用する目的
- お申し込みの受付・確認・ご連絡
- お支払い・返金の手続き
- アクティビティの実施（実施する事業者への必要な範囲での共有）
- お問い合わせへの回答

## 第三者への提供
アクティビティを実施する事業者へ、実施に必要な範囲（お名前・人数・当日の連絡先など）で提供します。法令に基づく場合を除き、それ以外の第三者には提供しません。

## お問い合わせ
個人情報の取扱いについてのお問い合わせは、お問い合わせフォームからご連絡ください。`,
  about: `## 運営者
沖縄県マリンレジャー事業協同組合

## サイトについて
沖縄のマリンアクティビティを探して予約できる、組合が運営する総合ガイド・予約サイトです。ご予約の窓口は組合が担当し、アクティビティは組合が確認した事業者が実施します。`,
};

export type SitePage = { slug: SitePageSlug; title: string; body: string; saved: boolean; updatedAt: Date | null };

/** 固定ページ（保存がなければ初期文） */
export async function getSitePage(db: DbOrTx, params: { shopId: string; slug: SitePageSlug }): Promise<SitePage> {
  const [row] = await db
    .select()
    .from(sitePages)
    .where(and(eq(sitePages.shopId, params.shopId), eq(sitePages.slug, params.slug)));
  return row
    ? { slug: params.slug, title: row.title, body: row.body, saved: true, updatedAt: row.updatedAt }
    : {
        slug: params.slug,
        title: SITE_PAGES[params.slug],
        body: DEFAULT_PAGE_BODIES[params.slug],
        saved: false,
        updatedAt: null,
      };
}

export async function listSitePages(db: DbOrTx, shopId: string): Promise<SitePage[]> {
  const rows = await db.select().from(sitePages).where(eq(sitePages.shopId, shopId));
  return (Object.keys(SITE_PAGES) as SitePageSlug[]).map((slug) => {
    const row = rows.find((r) => r.slug === slug);
    return row
      ? { slug, title: row.title, body: row.body, saved: true, updatedAt: row.updatedAt }
      : { slug, title: SITE_PAGES[slug], body: DEFAULT_PAGE_BODIES[slug], saved: false, updatedAt: null };
  });
}

export const sitePageSchema = z.object({
  title: z.string().trim().min(1).max(60),
  body: z.string().trim().min(1).max(20000),
});

export async function saveSitePage(
  db: DbOrTx,
  params: { shopId: string; slug: SitePageSlug; input: z.infer<typeof sitePageSchema>; actorId: string | null },
): Promise<void> {
  const values = { title: params.input.title, body: params.input.body, updatedBy: params.actorId };
  await db
    .insert(sitePages)
    .values({ shopId: params.shopId, slug: params.slug, ...values })
    .onConflictDoUpdate({ target: [sitePages.shopId, sitePages.slug], set: values });
}
