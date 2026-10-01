/**
 * UI レビュー用に管理画面と事業者画面を撮影する（開発用 DB 専用）。
 *   npx tsx scripts/capture-admin-screens.ts [baseUrl]
 * .env.local の SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD でログインする。初回は 2 要素認証を設定し、
 * TOTP の秘密鍵を .tmp/review-totp.txt に保存して次回以降のログインに使う。
 * 事業者画面は、照会先の事業者に確認用のアカウント（.tmp/review-operator.json）を発行して撮る。
 * capture-screens.ts で申し込んだ予約（.tmp/review-booking-url.txt）を、受入確認 → 事業者の回答 → 支払案内 →
 * 入金確認で確定まで進め、そのたびにお客様の確認ページも撮る。
 * 支払方法の案内が未設定なら、開発用の仮の文面を「設定」に入れる。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium, devices, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { config } from 'dotenv';
import { generate } from 'otplib';

config({ path: '.env.local', override: true, quiet: true });
const base = process.argv[2] ?? 'http://localhost:3000';
const outDir = process.env.SHOTS_DIR ?? '.tmp/shots/review';
const secretFile = '.tmp/review-totp.txt';
const operatorFile = '.tmp/review-operator.json';
const bookingUrlFile = '.tmp/review-booking-url.txt';
mkdirSync(outDir, { recursive: true });

type OperatorAccount = { email: string; password: string; secret?: string; operatorName: string };

async function shot(page: Page, name: string, fullPage = true) {
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${outDir}/${name}.jpg`, fullPage, quality: 55, type: 'jpeg' });
  console.info(`saved ${name}`);
}

/** ログイン（初回は 2 要素認証を設定して秘密鍵を返す） */
async function signIn(page: Page, email: string, password: string, secret: string | undefined, home: string) {
  await page.goto(`${base}/admin/login`);
  await page.getByLabel('メールアドレス').fill(email);
  await page.getByLabel('パスワード').fill(password);
  await page.getByRole('button', { name: 'ログイン' }).click();
  // リダイレクトが続くため、URL ではなく表示された画面で判定する
  const done = page.getByRole('heading', { name: home, level: 1 });
  const setup = page.getByLabel('パスワードを再入力');
  const verify = page.getByLabel('認証アプリの 6 桁のコード');
  await done.or(setup).or(verify).first().waitFor();
  let used = secret;
  if (await setup.isVisible()) {
    await setup.fill(password);
    await page.getByRole('button', { name: 'QR コードを表示' }).click();
    used = (await page.getByTestId('totp-secret').textContent())!.trim();
    await page.getByLabel('認証アプリの 6 桁のコード').fill(await generate({ secret: used }));
    await page.getByRole('button', { name: '設定を完了する' }).click();
  } else if (await verify.isVisible()) {
    if (!used) throw new Error(`${email} の 2 要素認証の秘密鍵がありません`);
    await verify.fill(await generate({ secret: used }));
    await page.getByRole('button', { name: '確認' }).click();
  }
  await done.waitFor();
  return used!;
}

async function loginAdmin(page: Page) {
  const saved = existsSync(secretFile) ? readFileSync(secretFile, 'utf8').trim() : undefined;
  const secret = await signIn(
    page,
    process.env.SEED_ADMIN_EMAIL!,
    process.env.SEED_ADMIN_PASSWORD!,
    saved,
    'ダッシュボード',
  );
  writeFileSync(secretFile, secret);
}

/** 支払方法の案内が空なら、開発用の仮の文面を入れる（支払案内を送れるように） */
async function ensurePaymentInstructions(page: Page) {
  await page.goto(`${base}/admin/settings`);
  const field = page.locator('#paymentInstructions');
  if ((await field.inputValue()).trim()) return;
  await field.fill(
    '（開発用の仮の文面です）\n下記の口座へお振り込みください。\n〇〇銀行 〇〇支店 普通 0000000\nオキナワケン マリンレジャー ジギョウ キョウドウクミアイ',
  );
  await page.getByRole('button', { name: '保存' }).click();
  await page.getByText('保存しました').first().waitFor();
}

/** 照会先の事業者に、確認用のアカウントを発行する（発行済みならそれを使う） */
async function ensureOperatorAccount(page: Page, operatorName: string): Promise<OperatorAccount> {
  if (existsSync(operatorFile)) {
    const saved = JSON.parse(readFileSync(operatorFile, 'utf8')) as OperatorAccount;
    if (saved.operatorName === operatorName) return saved;
  }
  await page.goto(`${base}/admin/operators`);
  await page
    .getByRole('link', { name: new RegExp(operatorName.replace(/[()（）]/g, '.')) })
    .first()
    .click();
  const email = `review-operator-${Date.now()}@example.com`;
  await page.getByLabel('ログイン用メールアドレス').fill(email);
  await page.getByLabel('担当者名').fill('確認用 担当');
  await page.getByRole('button', { name: 'アカウントを発行' }).click();
  await page.getByText('アカウントを発行しました。').waitFor();
  await shot(page, 'admin-desktop-16b-account-issued', false);
  const password = (await page.locator('code').first().textContent())!.trim();
  const account = { email, password, operatorName };
  writeFileSync(operatorFile, JSON.stringify(account));
  return account;
}

async function operatorSession(browser: Browser, options: BrowserContextOptions, account: OperatorAccount) {
  const page = await (await browser.newContext(options)).newPage();
  account.secret = await signIn(page, account.email, account.password, account.secret, 'ホーム');
  writeFileSync(operatorFile, JSON.stringify(account));
  return page;
}

/** 照会のフォームが畳んであれば開く（照会済みの事業者がいるとき） */
async function openRequestForm(page: Page) {
  const summary = page.getByText('ほかの事業者にも照会する・依頼を送り直す');
  if (await summary.count()) await summary.click();
}

/** お客様の申込を、受入確認 → 事業者の回答 → 支払案内 → 入金確認で確定まで進める（お客様・事業者の画面も撮る） */
async function processRequest(page: Page, browser: Browser, options: BrowserContextOptions) {
  const url = existsSync(bookingUrlFile) ? readFileSync(bookingUrlFile, 'utf8').trim() : null;
  if (!url) return null;
  const viewer = await (await browser.newContext(options)).newPage();
  await viewer.goto(url);
  const bookingNo = (await viewer.locator('p.font-mono').first().textContent())?.trim();
  await viewer.close();
  if (!bookingNo) return null;
  await page.goto(`${base}/admin/bookings?q=${bookingNo}`);
  const link = page.getByRole('link', { name: /沖縄 太郎 様/ }).first();
  if (!(await link.count())) return null;
  await link.click();
  await page.waitForURL(/\/admin\/bookings\/[0-9a-f-]{36}/);
  const bookingUrl = page.url();
  await shot(page, 'admin-desktop-05-booking-requested');

  // 申込を受けて自動で受入確認を送っていると、照会のフォームは畳んである
  await openRequestForm(page);
  const candidate = page.locator('input[type="checkbox"][name="operatorId"]').first();
  // 候補の行は「事業者名」のあとに送り先・照会の状況が続くので、事業者名だけを取り出す
  const operatorName = (await candidate.locator('xpath=ancestor::label').textContent())!
    .replace(/(送り先：|メールの送り先なし|照会済み|選ぶと)[\s\S]*$/, '')
    .trim();
  const account = await ensureOperatorAccount(page, operatorName);
  await page.goto(bookingUrl);
  await openRequestForm(page);
  await page.locator('input[type="checkbox"][name="operatorId"]').first().check();
  await page.getByLabel('事業者へのメモ（任意）').fill('2 名・初めての方です。13 時の回でも可能か教えてください');
  await page.getByRole('button', { name: '受入確認を依頼する' }).click();
  await page.getByText(/社へ受入確認を依頼しました/).waitFor();
  await shot(page, 'admin-desktop-05a-booking-operator-checking');

  const operator = await operatorSession(browser, options, account);
  await shot(operator, 'partner-desktop-01-home');
  await operator
    .getByRole('link', { name: /回答する/ })
    .first()
    .click();
  await operator.waitForURL(/\/partner\/requests\/[0-9a-f-]{36}/);
  await shot(operator, 'partner-desktop-02-request');
  const requestUrl = operator.url();
  await operator.getByRole('radio', { name: /条件付きで可/ }).check();
  await operator
    .getByLabel(/組合へのメモ/)
    .fill('送迎はできません。マリーナの受付に直接お越しいただければ受け入れられます');
  await operator.getByRole('button', { name: '回答する' }).click();
  await operator.getByText('回答しました。').waitFor();
  await shot(operator, 'partner-desktop-03-request-answered');

  await page.goto(`${base}/admin`);
  await shot(page, 'admin-desktop-01b-dashboard-responded');
  await page.goto(bookingUrl);
  await shot(page, 'admin-desktop-05b-booking-responded');
  await page.getByRole('button', { name: '支払案内を送る' }).click();
  await shot(page, 'admin-desktop-05c-dialog-payment', false);
  // 条件付きの回答なので、条件を調整して合意したことを確かめてから送る
  await page
    .getByRole('dialog')
    .getByLabel(/条件をお客様と調整し/)
    .check();
  await page
    .getByRole('dialog')
    .getByLabel(/合意した内容/)
    .fill('送迎なし・マリーナ受付に直接集合で、お客様と事業者が合意');
  await page.getByRole('dialog').getByRole('button', { name: '支払案内を送る' }).click();
  await page.getByText('支払待ちにしました。').waitFor();
  await shot(page, 'admin-desktop-05d-booking-awaiting');
  const customer = await (await browser.newContext(options)).newPage();
  await customer.goto(url);
  await shot(customer, 'desktop-12-awaiting-payment');
  await page.getByRole('button', { name: '入金を確認して確定する' }).click();
  await shot(page, 'admin-desktop-05e-dialog-confirm', false);
  await page.getByRole('dialog').getByRole('button', { name: '入金を確認して確定する' }).click();
  await page.getByText('入金を記録し、予約を確定しました。').waitFor();
  await shot(page, 'admin-desktop-05f-booking-confirmed');
  await page.getByRole('button', { name: '取り消す' }).click();
  await shot(page, 'admin-desktop-05g-dialog-cancel', false);
  await page.keyboard.press('Escape');
  await customer.goto(url);
  await shot(customer, 'desktop-13-confirmed');
  // 確定したあとの、実施事業者の受入確認の画面（予約の詳細へ案内する）
  await operator.goto(requestUrl);
  await shot(operator, 'partner-desktop-03b-request-confirmed');

  await operator.goto(`${base}/partner/bookings`);
  await shot(operator, 'partner-desktop-04-bookings');
  await operator
    .getByRole('link', { name: /沖縄 太郎 様/ })
    .first()
    .click();
  await operator.waitForURL(/\/partner\/bookings\/[0-9a-f-]{36}/);
  await shot(operator, 'partner-desktop-05-booking');
  return { operator, account };
}

async function run(kind: 'desktop' | 'mobile') {
  const browser = await chromium.launch();
  const options: BrowserContextOptions =
    kind === 'desktop'
      ? { viewport: { width: 1440, height: 900 }, locale: 'ja-JP' }
      : { ...devices['iPhone 13'], locale: 'ja-JP' };
  const page = await (await browser.newContext(options)).newPage();
  if (kind === 'desktop') {
    await page.goto(`${base}/admin/login`);
    await shot(page, 'admin-00-login', false);
  }
  await loginAdmin(page);
  const p = (n: string) => `admin-${kind}-${n}`;
  await ensurePaymentInstructions(page);

  await page.goto(`${base}/admin`);
  await shot(page, p('01-dashboard'));
  let operator: Page | null = null;
  let account: OperatorAccount | null = existsSync(operatorFile)
    ? (JSON.parse(readFileSync(operatorFile, 'utf8')) as OperatorAccount)
    : null;
  if (kind === 'desktop') {
    const result = await processRequest(page, browser, options);
    if (result) ({ operator, account } = result);
  }
  await page.goto(`${base}/admin/bookings`);
  await shot(page, p('04-bookings'));
  await page.goto(`${base}/admin/timetable`);
  await shot(page, p('02-timetable'));
  await page.locator('a[data-slot-id]:visible').first().click();
  await page.waitForURL(/\/admin\/slots\//);
  await shot(page, p('03-slot'));
  // 一括の天候中止の確認ダイアログ（押さずに閉じる）
  const weather = page.getByRole('button', { name: 'この回の予約を一括で天候中止にする' });
  if (await weather.count()) {
    await weather.click();
    await shot(page, p('03b-slot-weather-dialog'), false);
    await page.keyboard.press('Escape');
  }
  await page.goto(`${base}/admin/bookings/new`);
  await page.locator('a[href*="/admin/bookings/new?slot="]').first().click();
  await page.waitForURL(/slot=/);
  await shot(page, p('07-manual-form'));
  await page.goto(`${base}/admin/menus`);
  await shot(page, p('08-menus'));
  await page.locator('a[href^="/admin/menus/"]').filter({ hasNotText: '追加' }).first().click();
  await page.waitForURL(/\/admin\/menus\/[0-9a-f-]{36}$/);
  await shot(page, p('09-menu-edit'));
  await page.goto(`${base}/admin/activities`);
  await shot(page, p('10-activities'));
  await page.goto(`${base}/admin/pages/guide`);
  await shot(page, p('11-page-edit'));
  await page.goto(`${base}/admin/inquiries`);
  await shot(page, p('12-inquiries'));
  await page.goto(`${base}/admin/settings`);
  await shot(page, p('13-settings'));
  await page.goto(`${base}/admin/reports`);
  await shot(page, p('14-reports'));
  await page.goto(`${base}/admin/operators`);
  await shot(page, p('15-operators'));
  await page.locator('a[href^="/admin/operators/"]').filter({ hasNotText: '登録申請' }).first().click();
  await page.waitForURL(/\/admin\/operators\/[0-9a-f-]{36}$/);
  await shot(page, p('16-operator'));
  await page.goto(`${base}/admin/operators/applications`);
  await shot(page, p('17-applications'));
  const application = page.locator('a[href^="/admin/operators/applications/"]').first();
  if (await application.count()) {
    await application.click();
    await page.waitForURL(/\/applications\/[0-9a-f-]{36}$/);
    await shot(page, p('18-application'));
  }

  // 事業者画面
  if (account) {
    operator ??= await operatorSession(browser, options, account);
    const q = (n: string) => `partner-${kind}-${n}`;
    await operator.goto(`${base}/partner`);
    await shot(operator, q('01-home'));
    await operator.goto(`${base}/partner/requests`);
    await shot(operator, q('06-requests'));
    await operator.goto(`${base}/partner/bookings`);
    await shot(operator, q('04-bookings'));
    await operator.goto(`${base}/partner/profile`);
    await shot(operator, q('07-profile'));
    await operator.goto(`${base}/partner/documents`);
    await shot(operator, q('08-documents'));
    // プラン（事業者が登録・編集する）
    await operator.goto(`${base}/partner/plans`);
    await shot(operator, q('09-plans'));
    await operator.goto(`${base}/partner/plans/new`);
    await shot(operator, q('10-plan-new'));
  }
  await browser.close();
}

(async () => {
  await run('desktop');
  await run('mobile');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
