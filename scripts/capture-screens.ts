/**
 * UI レビュー用に、お客様向けの主要な画面を PC（1440px）とスマホ（390px）で撮影する。
 *   npx tsx scripts/capture-screens.ts [baseUrl]
 * 開発サーバー（npm run dev）と、取り込み済みのデータ（npm run import:ginowan）が必要。
 * 申込の受付画面を撮るため、実際に 1 件申し込む（開発用 DB でのみ使うこと）。
 * 申込の確認ページの URL は .tmp/review-booking-url.txt に保存し、管理画面の撮影で状態を進めて撮る。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, devices, type Page } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:3000';
const outDir = process.env.SHOTS_DIR ?? '.tmp/shots/review';
mkdirSync(outDir, { recursive: true });

function futureDate(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(d);
}

async function shot(page: Page, name: string, fullPage = true) {
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${outDir}/${name}.jpg`, fullPage, quality: 55, type: 'jpeg' });
  console.info(`saved ${name}`);
}

async function run(kind: 'desktop' | 'mobile') {
  const browser = await chromium.launch();
  const context = await browser.newContext(
    kind === 'desktop'
      ? { viewport: { width: 1440, height: 900 }, locale: 'ja-JP' }
      : { ...devices['iPhone 13'], locale: 'ja-JP' },
  );
  const page = await context.newPage();
  const date = futureDate(kind === 'desktop' ? 10 : 11);

  await page.goto(`${base}/ja`);
  await shot(page, `${kind}-01-home`);
  await page.goto(`${base}/ja/activities/parasailing`);
  await shot(page, `${kind}-02-activity`);
  await page.goto(`${base}/ja/menus/ginowan-parasailing?date=${date}`);
  await shot(page, `${kind}-03-detail`);
  await page.goto(`${base}/ja/search?q=${encodeURIComponent('初心者')}`);
  await shot(page, `${kind}-04-search`, false);

  // 申込フロー
  await page.goto(`${base}/ja/menus/ginowan-parasailing?date=${date}`);
  await page
    .getByRole('region', { name: /のタイムテーブル/ })
    .getByRole('link', { name: /申し込む/ })
    .first()
    .click();
  await page.waitForURL(/\/book\?/);
  await shot(page, `${kind}-05-book`);
  await page.getByRole('button', { name: /この内容で申し込む/ }).click();
  await shot(page, `${kind}-06-book-validation`, false);
  await page.getByRole('spinbutton').first().fill('2');
  await page.getByLabel('お名前').fill('沖縄 太郎');
  await page.getByLabel('メールアドレス', { exact: true }).fill(`review-${kind}-${Date.now()}@example.com`);
  await page.getByLabel('メールアドレス（確認）').fill('mismatch@example.com');
  await page.getByLabel('電話番号').fill('090-1234-5678');
  await page.getByLabel('ご連絡事項').fill('小学生の子供がいます');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /この内容で申し込む/ }).click();
  await page.locator('[id$="-error"]', { hasText: '確認用のメールアドレスが一致しません' }).waitFor();
  await shot(page, `${kind}-07-book-error`, false);
  await page
    .getByLabel('メールアドレス（確認）')
    .fill(await page.getByLabel('メールアドレス', { exact: true }).inputValue());
  await page.getByRole('button', { name: /この内容で申し込む/ }).click();
  await page.waitForURL(/\/bookings\//);
  await shot(page, `${kind}-08-requested`);
  if (kind === 'desktop') writeFileSync('.tmp/review-booking-url.txt', page.url());

  await page.goto(`${base}/ja/menus/not-found-plan`);
  await shot(page, `${kind}-09-404`, false);
  await page.goto(`${base}/ja/how-to-book`);
  await shot(page, `${kind}-10-page`);
  await page.goto(`${base}/ja/contact`);
  await shot(page, `${kind}-11-contact`);
  await page.goto(`${base}/ja/partner/apply`);
  await shot(page, `${kind}-14-partner-apply`);
  await page.getByRole('button', { name: '申請する' }).click();
  await shot(page, `${kind}-15-partner-apply-validation`, false);
  await browser.close();
}

(async () => {
  await run('desktop');
  await run('mobile');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
