import { expect, test, type Page } from '@playwright/test';
import { generate } from 'otplib';
import { addDays, localDate } from '../../src/lib/dates';
import { E2E_ADMIN } from './constants';

const tomorrow = addDays(localDate(new Date(), 'Asia/Tokyo'), 1);

async function login(page: Page) {
  await page.goto('/admin/login');
  await page.getByLabel('メールアドレス').fill(E2E_ADMIN.email);
  await page.getByLabel('パスワード').fill(E2E_ADMIN.password);
  await page.getByRole('button', { name: 'ログイン' }).click();
}

test.describe.serial('管理画面', () => {
  let totpSecret = '';

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
    await expect(page.getByRole('link', { name: 'タイムテーブル' })).toBeVisible();
  });

  test('2 回目以降はコード入力でログインし、手動予約で残り枠が減る', async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL(/\/admin\/2fa$/);
    await page.getByLabel('認証アプリの 6 桁のコード').fill(await generate({ secret: totpSecret }));
    await page.getByRole('button', { name: '確認' }).click();
    await expect(page.getByRole('link', { name: 'タイムテーブル' })).toBeVisible();

    await page.goto(`/admin?date=${tomorrow}`);
    const cell = page.locator('a[data-slot-id]').first();
    await expect(cell).toContainText('10:00');
    await cell.click();
    await expect(page.getByTestId('reserved')).toBeVisible();
    const before = Number(await page.getByTestId('reserved').textContent());

    await page.getByRole('link', { name: 'この回に手動予約' }).click();
    await page.getByRole('radio', { name: '電話' }).check();
    await page.getByLabel(/大人/).fill('1');
    await page.getByLabel('お名前（必須）').fill('電話 次郎');
    await page.getByLabel('電話番号').fill('080-1111-2222');
    await page.getByRole('button', { name: '予約を登録' }).click();
    await expect(page.getByText('予約を登録しました。')).toBeVisible();
    await expect(page.getByText('電話 次郎')).toBeVisible();

    await page.getByRole('link', { name: 'この回の予約者一覧へ' }).click();
    await expect(page.getByTestId('reserved')).toHaveText(String(before + 1));
  });

  test('満席の回は理由を入力すれば定員を超えて登録できる', async ({ page }) => {
    await login(page);
    await page.getByLabel('認証アプリの 6 桁のコード').fill(await generate({ secret: totpSecret }));
    await page.getByRole('button', { name: '確認' }).click();
    await expect(page.getByRole('link', { name: 'タイムテーブル' })).toBeVisible();

    const date = addDays(tomorrow, 2);
    await page.goto(`/admin?date=${date}`);
    await page.locator('a[data-slot-id]').first().click();
    await page.getByRole('link', { name: 'この回に手動予約' }).click();
    await page.getByLabel(/大人/).fill('6');
    await page.getByLabel('お名前（必須）').fill('団体 様');
    await page.getByLabel('電話番号').fill('080-3333-4444');
    await page.getByRole('button', { name: '予約を登録' }).click();
    await expect(page.getByRole('alert').filter({ hasText: '満席です' })).toBeVisible();

    await page.getByLabel(/定員超過の理由/).fill('ボート 2 隻で対応');
    await page.getByRole('button', { name: '予約を登録' }).click();
    await expect(page.getByText('予約を登録しました。')).toBeVisible();
    await expect(page.getByText('ボート 2 隻で対応')).toBeVisible();
  });
});
