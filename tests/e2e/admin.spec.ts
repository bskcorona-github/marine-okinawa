import { expect, test, type Page } from '@playwright/test';
import { generate } from 'otplib';
import { addDays, localDate, monthOf } from '../../src/lib/dates';
import { E2E_ADMIN } from './constants';

const today = localDate(new Date(), 'Asia/Tokyo');
const tomorrow = addDays(today, 1);
// お客様の申込から確定までの流れに使う日（ほかの E2E と重ならない日）
const requestDate = addDays(today, 11);

async function login(page: Page) {
  await page.goto('/admin/login');
  await page.getByLabel('メールアドレス').fill(E2E_ADMIN.email);
  await page.getByLabel('パスワード').fill(E2E_ADMIN.password);
  await page.getByRole('button', { name: 'ログイン' }).click();
}

test.describe.serial('管理画面', () => {
  let totpSecret = '';

  async function loginWithCode(page: Page) {
    await login(page);
    await expect(page).toHaveURL(/\/admin\/2fa$/);
    await page.getByLabel('認証アプリの 6 桁のコード').fill(await generate({ secret: totpSecret }));
    await page.getByRole('button', { name: '確認' }).click();
    await expect(page.getByRole('heading', { name: 'ダッシュボード' })).toBeVisible();
  }

  test('未ログインで管理画面を開くとログインへ移動する', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin\/login$/);
  });

  test('初回ログインで 2 要素認証を設定する', async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL(/\/admin\/2fa\/setup$/);
    await page.getByLabel('パスワードを再入力').fill(E2E_ADMIN.password);
    await page.getByRole('button', { name: 'QR コードを表示' }).click();
    totpSecret = (await page.getByTestId('totp-secret').textContent()) ?? '';
    expect(totpSecret).not.toBe('');
    await page.getByLabel('認証アプリの 6 桁のコード').fill(await generate({ secret: totpSecret }));
    await page.getByRole('button', { name: '設定を完了する' }).click();
    await expect(page.getByRole('heading', { name: 'ダッシュボード' })).toBeVisible();
  });

  test('手動予約で残り枠が減り、取り消すと枠が戻る（確認ダイアログと理由つき）', async ({ page }) => {
    await loginWithCode(page);
    await page.goto(`/admin/timetable?date=${tomorrow}`);
    const cell = page.locator('a[data-slot-id]:visible').first();
    await expect(cell).toHaveAttribute('aria-label', /10:00/);
    await cell.click();
    await expect(page.getByTestId('reserved')).toBeVisible();
    const before = Number(await page.getByTestId('reserved').textContent());

    await page.getByRole('link', { name: 'この回に手動予約' }).click();
    await page.getByRole('radio', { name: '電話' }).check();
    await page.getByRole('spinbutton', { name: /大人/ }).fill('1');
    await page.getByLabel('お名前（必須）').fill('電話 次郎');
    await page.getByLabel('電話番号').fill('080-1111-2222');
    await page.getByRole('button', { name: '予約を登録' }).click();
    await expect(page.getByText('予約を登録しました。')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('仮受付');

    await page.getByRole('link', { name: 'この回を見る' }).click();
    await expect(page.getByTestId('reserved')).toHaveText(String(before + 1));

    await page.getByRole('link', { name: /電話 次郎 様/ }).click();
    await page.getByRole('button', { name: '取り消す' }).click();
    const dialog = page.getByRole('dialog', { name: '「取消」にしますか？' });
    await expect(dialog.getByText('1名分の枠が回に戻ります。')).toBeVisible();
    await dialog.getByLabel('取消の区分（必須）').selectOption('customer');
    await dialog.getByLabel(/取消の理由/).fill('お客様から電話で連絡');
    await dialog.getByRole('button', { name: '取り消す' }).click();
    await expect(page.getByText('予約を取り消しました。枠を回に戻しました。')).toBeVisible();
    await expect(page.getByText('お客様から電話で連絡').first()).toBeVisible();
    await expect(page.getByRole('button', { name: '取り消す' })).toHaveCount(0);

    await page.getByRole('link', { name: 'この回を見る' }).click();
    await expect(page.getByTestId('reserved')).toHaveText(String(before));
  });

  test('満席の回は理由を入力すれば定員を超えて登録できる', async ({ page }) => {
    await loginWithCode(page);
    const date = addDays(tomorrow, 2);
    await page.goto(`/admin/timetable?date=${date}`);
    await page.locator('a[data-slot-id]:visible').first().click();
    await page.getByRole('link', { name: 'この回に手動予約' }).click();
    await page.getByRole('spinbutton', { name: /大人/ }).fill('6');
    await page.getByLabel('お名前（必須）').fill('団体 様');
    await page.getByLabel('電話番号').fill('080-3333-4444');
    await page.getByRole('button', { name: '予約を登録' }).click();
    await expect(page.getByRole('alert').filter({ hasText: '満席です' })).toBeVisible();

    await page.getByLabel(/定員超過の理由/).fill('ボート 2 隻で対応');
    await page.getByRole('button', { name: '予約を登録' }).click();
    await expect(page.getByText('予約を登録しました。')).toBeVisible();
    await expect(page.getByText('ボート 2 隻で対応')).toBeVisible();
  });

  test('Web の申込を、支払案内 → 入金の確認で確定する。確定後はお客様に実施事業者を案内する', async ({ page }) => {
    // お客様の申込
    await page.goto(`/ja/menus/blue-cave?month=${monthOf(requestDate)}&date=${requestDate}`);
    await page
      .getByRole('region', { name: /のタイムテーブル/ })
      .getByRole('link', { name: '申し込む' })
      .click();
    await page.getByRole('spinbutton', { name: /大人/ }).fill('2');
    await page.getByLabel('お名前').fill('申込 花子');
    await page.getByLabel('メールアドレス', { exact: true }).fill('request@example.com');
    await page.getByLabel('メールアドレス（確認）').fill('request@example.com');
    await page.getByLabel('電話番号').fill('090-4444-5555');
    await page.getByLabel('参加条件・キャンセル規定・個人情報の取扱いに同意します').check();
    await page.getByRole('button', { name: /この内容で申し込む/ }).click();
    await expect(page.getByRole('heading', { name: 'お申し込みを受け付けました' })).toBeVisible();
    const customerUrl = page.url();

    // 組合：ダッシュボード → 未確定の申込 → 支払案内
    await loginWithCode(page);
    await expect(page.getByText('申込 花子 様')).toBeVisible();
    await page.getByRole('link', { name: /申込 花子 様/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('仮受付');
    await page.getByRole('button', { name: '支払案内を送る' }).click();
    const payDialog = page.getByRole('dialog', { name: '「支払待ち」にしますか？' });
    // 事業者確認中を通らないときは、電話などで受入を確かめたことを残す
    await expect(payDialog.getByText('テスト銀行 普通 0000000')).toBeVisible();
    await payDialog.getByLabel(/に受入を確認しました（電話など）/).check();
    await payDialog.getByRole('button', { name: '支払案内を送る' }).click();
    await expect(page.getByText('支払待ちにしました。')).toBeVisible();
    await expect(page.getByText('お客様にメールを送信しました。')).toBeVisible();

    // 入金を確認して確定する（入金額は料金が入っている）
    await page.getByRole('button', { name: '入金を確認して確定する' }).click();
    const confirmDialog = page.getByRole('dialog', { name: '「予約確定」にしますか？' });
    await expect(confirmDialog.getByLabel('入金額（円）')).toHaveValue('10000');
    await confirmDialog.getByLabel('入金のメモ（振込名義など・任意）').fill('シンセイ ハナコ');
    await confirmDialog.getByRole('button', { name: '入金を確認して確定する' }).click();
    await expect(page.getByText('入金を記録し、予約を確定しました。')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('予約確定');
    // 状態の履歴に、申込から確定までが残る
    const history = page.locator('section', { has: page.getByRole('heading', { name: '状態の履歴' }) });
    await expect(history.getByText('仮受付 → 支払待ち')).toBeVisible();
    await expect(history.getByText('支払待ち → 予約確定')).toBeVisible();

    // お客様の画面：確定になり、実施事業者と当日の連絡先を案内する
    await page.goto(customerUrl);
    await expect(page.getByRole('heading', { name: 'ご予約が確定しました' })).toBeVisible();
    await expect(page.getByText('アクアマリン E2E').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'カレンダーに追加' })).toBeVisible();
  });

  test('予約台帳を CSV で出力できる', async ({ page }) => {
    await loginWithCode(page);
    await page.goto('/admin/bookings');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: 'CSV 出力' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^bookings-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
