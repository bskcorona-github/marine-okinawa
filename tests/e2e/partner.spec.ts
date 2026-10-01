import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { generate } from 'otplib';
import { addDays, localDate, monthOf } from '../../src/lib/dates';
import { E2E_PARTNER_ADMIN } from './constants';

const today = localDate(new Date(), 'Asia/Tokyo');
// ほかの E2E と重ならない日
const requestDate = addDays(today, 14);
const OPERATOR_EMAIL = 'staff@aqua.e2e.example.com';

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/admin/login');
  await page.getByLabel('メールアドレス').fill(email);
  await page.getByLabel('パスワード').fill(password);
  await page.getByRole('button', { name: 'ログイン' }).click();
}

/** 初回ログインの 2 要素認証の設定。認証アプリの秘密鍵を返す */
async function setUp2fa(page: Page, password: string) {
  await expect(page).toHaveURL(/\/admin\/2fa\/setup$/);
  await page.getByLabel('パスワードを再入力').fill(password);
  await page.getByRole('button', { name: 'QR コードを表示' }).click();
  const secret = ((await page.getByTestId('totp-secret').textContent()) ?? '').trim();
  expect(secret).not.toBe('');
  await page.getByLabel('認証アプリの 6 桁のコード').fill(await generate({ secret }));
  await page.getByRole('button', { name: '設定を完了する' }).click();
  return secret;
}

async function signInWithCode(page: Page, email: string, password: string, secret: string) {
  await signIn(page, email, password);
  await expect(page).toHaveURL(/\/admin\/2fa$/);
  await page.getByLabel('認証アプリの 6 桁のコード').fill(await generate({ secret }));
  await page.getByRole('button', { name: '確認' }).click();
}

type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

test.describe.serial('事業者画面', () => {
  let operatorPassword = '';
  // ログインのし直しを減らす（本番のログインの回数制限は 1 分に 10 回まで）。初回のログインの状態を使い回す
  let adminState: StorageState | null = null;
  let operatorState: StorageState | null = null;

  const adminPage = async (page: Page) => {
    await page.context().addCookies(adminState!.cookies);
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'ダッシュボード' })).toBeVisible();
  };
  const operatorPage = async (browser: Browser) => {
    const context = await browser.newContext({
      locale: 'ja-JP',
      timezoneId: 'Asia/Tokyo',
      storageState: operatorState!,
    });
    const page = await context.newPage();
    await page.goto('/partner');
    await expect(page.getByRole('heading', { name: 'ホーム' })).toBeVisible();
    return page;
  };

  test('組合が事業者のアカウントを発行する（仮パスワードは 1 回だけ表示）', async ({ page }) => {
    await signIn(page, E2E_PARTNER_ADMIN.email, E2E_PARTNER_ADMIN.password);
    await setUp2fa(page, E2E_PARTNER_ADMIN.password);
    await expect(page.getByRole('heading', { name: 'ダッシュボード' })).toBeVisible();
    adminState = await page.context().storageState();

    await page.goto('/admin/operators');
    await page.getByRole('link', { name: /アクアマリン E2E/ }).click();
    await page.getByLabel('ログイン用メールアドレス').fill(OPERATOR_EMAIL);
    await page.getByLabel('担当者名').fill('アクア 担当');
    await page.getByRole('button', { name: 'アカウントを発行' }).click();
    await expect(page.getByText('アカウントを発行しました。')).toBeVisible();
    operatorPassword = ((await page.locator('code').first().textContent()) ?? '').trim();
    expect(operatorPassword.length).toBeGreaterThanOrEqual(20);

    // 再読み込みすると仮パスワードは出ない
    await page.reload();
    await expect(page.getByText(OPERATOR_EMAIL, { exact: true })).toBeVisible();
    await expect(page.locator('code')).toHaveCount(0);
  });

  test('事業者は初回ログインで 2 要素認証を設定し、事業者画面だけを使える', async ({ page }) => {
    await signIn(page, OPERATOR_EMAIL, operatorPassword);
    const operatorSecret = await setUp2fa(page, operatorPassword);
    await expect(page).toHaveURL(/\/partner$/);
    await expect(page.getByRole('heading', { name: 'ホーム' })).toBeVisible();
    operatorState = await page.context().storageState();
    // 2 回目からは、2 要素認証のコードを入れてログインする
    await page.context().clearCookies();
    await signInWithCode(page, OPERATOR_EMAIL, operatorPassword, operatorSecret);
    await expect(page.getByRole('heading', { name: 'ホーム' })).toBeVisible();
    // 管理画面を開いても、事業者画面へ戻される
    await page.goto('/admin/bookings');
    await expect(page).toHaveURL(/\/partner$/);
  });

  test('組合が受入確認を依頼し、事業者が回答する。予約確定後は事業者に代表者が見える', async ({ page, browser }) => {
    // お客様の申込
    await page.goto(`/ja/menus/blue-cave?month=${monthOf(requestDate)}&date=${requestDate}`);
    await page
      .getByRole('region', { name: /のタイムテーブル/ })
      .getByRole('link', { name: '申し込む' })
      .click();
    await page.getByRole('spinbutton', { name: /大人/ }).fill('2');
    await page.getByLabel('お名前').fill('照会 花子');
    await page.getByLabel('メールアドレス', { exact: true }).fill('inquiry-flow@example.com');
    await page.getByLabel('メールアドレス（確認）').fill('inquiry-flow@example.com');
    await page.getByLabel('電話番号').fill('090-5555-6666');
    await page.getByLabel('参加条件・キャンセル規定・個人情報の取扱いに同意します').check();
    await page.getByRole('button', { name: /この内容で申し込む/ }).click();
    await expect(page.getByRole('heading', { name: 'お申し込みを受け付けました' })).toBeVisible();

    // 組合：受入確認を依頼する
    await adminPage(page);
    await page.getByRole('link', { name: /照会 花子 様/ }).click();
    await page.waitForURL(/\/admin\/bookings\/[0-9a-f-]{36}/);
    const bookingUrl = page.url();
    await page.getByRole('checkbox', { name: /アクアマリン E2E/ }).check();
    await page.getByLabel('事業者へのメモ（任意）').fill('2 名です');
    await page.getByRole('button', { name: '受入確認を依頼する' }).click();
    await expect(page.getByText('1 社へ受入確認を依頼しました。')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('事業者確認中');

    // 事業者：照会には、お客様の氏名・連絡先を出さない
    const operator = await operatorPage(browser);
    await expect(operator.getByText('回答待ちの受入確認（1 件）')).toBeVisible();
    await operator.getByRole('link', { name: /回答する/ }).click();
    await expect(operator.getByText('組合からのメモ：2 名です')).toBeVisible();
    await expect(operator.getByText('照会 花子')).toHaveCount(0);
    await expect(operator.getByText('090-5555-6666')).toHaveCount(0);
    await operator.getByRole('radio', { name: /受入可/ }).check();
    await operator.getByRole('button', { name: '回答する' }).click();
    await expect(operator.getByText('回答しました。')).toBeVisible();

    // 組合：回答を見て支払案内 → 入金を確認して確定（事業者にも知らせる）
    await page.goto(bookingUrl);
    await expect(page.getByText('受入可', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '支払案内を送る' }).click();
    const payDialog = page.getByRole('dialog', { name: '「支払待ち」にしますか？' });
    // 事業者確認中から進むときは、電話での確認のチェックは要らない
    await expect(payDialog.getByLabel(/に受入を確認しました/)).toHaveCount(0);
    await expect(payDialog.getByText('アクアマリン E2E：受入可')).toBeVisible();
    await payDialog.getByRole('button', { name: '支払案内を送る' }).click();
    await expect(page.getByText('支払待ちにしました。')).toBeVisible();
    await page.getByRole('button', { name: '入金を確認して確定する' }).click();
    const confirmDialog = page.getByRole('dialog', { name: '「予約確定」にしますか？' });
    await expect(confirmDialog.getByLabel('実施事業者に予約確定をメールで知らせる')).toBeChecked();
    await confirmDialog.getByRole('button', { name: '入金を確認して確定する' }).click();
    await expect(page.getByText('入金を記録し、予約を確定しました。')).toBeVisible();
    await expect(page.getByText('実施事業者にもメールで知らせました。')).toBeVisible();

    // 事業者：確定した予約では、代表者の氏名と電話が見える（メールアドレスは出さない）
    await operator.goto('/partner/bookings');
    await operator.getByRole('link', { name: /照会 花子 様/ }).click();
    await expect(operator.getByRole('heading', { name: '代表者' })).toBeVisible();
    await expect(operator.getByRole('link', { name: /090-5555-6666/ })).toBeVisible();
    await expect(operator.getByText('inquiry-flow@example.com')).toHaveCount(0);
    await operator.context().close();
  });

  test('開始した予約に催行報告を送る。他社の予約は開けない', async ({ page, browser }) => {
    const operator = await operatorPage(browser);
    await expect(operator.getByText('催行報告待ち（1 件）')).toBeVisible();
    await operator.goto('/partner/bookings');
    await operator.getByRole('link', { name: /報告 太郎 様/ }).click();
    await operator.getByRole('radio', { name: /実施した/ }).check();
    await operator.getByRole('spinbutton', { name: /実績の人数/ }).fill('3');
    await operator.getByRole('button', { name: '報告する' }).click();
    await expect(operator.getByText('催行報告を送りました。')).toBeVisible();
    await expect(operator.getByRole('heading', { level: 1 })).toContainText('催行済み');

    // 組合：実績人数の違いを知らせる
    await adminPage(page);
    await page.goto('/admin/bookings?q=' + encodeURIComponent('報告 太郎'));
    await page.getByRole('link', { name: /報告 太郎 様/ }).click();
    await expect(page.getByText(/実績人数（3名）が予約の人数（2名）と違います/)).toBeVisible();

    // 他社（ココマリン）の予約の URL を開いても見えない
    await page.goto('/admin/bookings?q=' + encodeURIComponent('他社 花子'));
    await page.getByRole('link', { name: /他社 花子 様/ }).click();
    await page.waitForURL(/\/admin\/bookings\/[0-9a-f-]{36}/);
    const otherId = new URL(page.url()).pathname.split('/').pop()!;
    const response = await operator.goto(`/partner/bookings/${otherId}`);
    expect(response?.status()).toBe(404);
    await operator.context().close();
  });
  test('事業者がプランを登録して公開を申請し、組合が承認するとサイトに出る', async ({ page, browser }) => {
    const title = 'E2E サンセットシュノーケル';
    const operator = await operatorPage(browser);
    await operator.getByRole('link', { name: 'プラン', exact: true }).first().click();
    await operator.getByRole('link', { name: 'プランを追加' }).click();
    await operator.getByLabel('プラン名').fill(title);
    await operator.getByLabel('アクティビティ').selectOption({ label: 'シュノーケル' });
    await operator.getByLabel('料金（円・税込）').first().fill('6000');
    await operator.getByRole('button', { name: '下書きを保存して開催時間の登録へ' }).click();
    await operator.waitForURL(/\/partner\/plans\/[0-9a-f-]{36}\/schedule/);
    await expect(operator.getByText('プランを作成しました。')).toBeVisible();

    // 開催時間（毎日 9:00・定員 6 名）を登録する
    await operator.getByLabel('開始時刻').fill('09:00');
    await operator.getByLabel(/^定員/).first().fill('6');
    await operator.getByRole('button', { name: 'ルールを追加' }).click();
    await expect(operator.getByText('保存し、今後 180 日分の回に反映しました。')).toBeVisible();

    await operator.getByRole('link', { name: 'プランの編集へ' }).click();
    await operator.getByRole('button', { name: '公開を申請する' }).click();
    await expect(operator.getByText(/公開を申請しました。/)).toBeVisible();

    // 組合：審査待ちから開いて承認する
    await adminPage(page);
    await page.goto('/admin/menus?review=1');
    await page.getByRole('link', { name: title }).click();
    await expect(page.getByRole('heading', { name: '公開の申請' })).toBeVisible();
    await page.getByRole('button', { name: '承認して公開する' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '公開する' }).click();
    await expect(page.getByText('公開を承認し、プランを公開しました。')).toBeVisible();
    const publicHref = await page.getByRole('link', { name: /公開ページ/ }).getAttribute('href');

    // お客様のサイトに出る。事業者画面では「公開中」になる
    await page.goto(publicHref!);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(title);
    await operator.reload();
    await expect(operator.getByText('公開中です。')).toBeVisible();
    await operator.context().close();
  });
});
