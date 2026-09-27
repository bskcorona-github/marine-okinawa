import { expect, test } from '@playwright/test';
import { addDays, localDate, monthOf } from '../../src/lib/dates';

// 管理画面の E2E（明日・明後日の回を使う）と重ならない日付を使う
const bookingDate = addDays(localDate(new Date(), 'Asia/Tokyo'), 5);
const dayUrl = `/ja/menus/blue-cave?month=${monthOf(bookingDate)}&date=${bookingDate}`;

test('カレンダーで空きを確認し、現地払いで予約できる', async ({ page }) => {
  await page.goto('/ja');
  await page.getByRole('link', { name: /青の洞窟シュノーケル/ }).click();
  await expect(page.getByRole('heading', { name: '青の洞窟シュノーケル', level: 1 })).toBeVisible();

  await page.goto(dayUrl);
  const timetable = page.getByRole('region', { name: /のタイムテーブル/ });
  await expect(timetable.getByText('10:00')).toBeVisible();
  await expect(timetable.getByText('残り 5 名')).toBeVisible();
  await timetable.getByRole('link', { name: '予約する' }).click();

  await expect(page.getByRole('heading', { name: '予約内容の入力' })).toBeVisible();
  await page.getByLabel(/大人/).fill('2');
  await expect(page.getByTestId('total')).toHaveText('￥10,000');
  await page.getByLabel('お名前').fill('沖縄 太郎');
  await page.getByLabel('メールアドレス', { exact: true }).fill('taro@example.com');
  await page.getByLabel('メールアドレス（確認）').fill('taro@example.com');
  await page.getByLabel('電話番号').fill('090-1234-5678');
  await page.getByRole('button', { name: '予約を確定する' }).click();

  await expect(page.getByRole('heading', { name: 'ご予約内容' })).toBeVisible();
  await expect(page.getByText('予約番号')).toBeVisible();
  await expect(page.getByText('現地払い')).toBeVisible();

  await page.goto(dayUrl);
  await expect(page.getByRole('region', { name: /のタイムテーブル/ }).getByText('残り 3 名')).toBeVisible();
});

test('確認用メールアドレスが違うとエラーになり、入力は残る', async ({ page }) => {
  await page.goto(dayUrl);
  await page
    .getByRole('region', { name: /のタイムテーブル/ })
    .getByRole('link', { name: '予約する' })
    .click();
  await page.getByLabel(/大人/).fill('1');
  await page.getByLabel('お名前').fill('那覇 花子');
  await page.getByLabel('メールアドレス', { exact: true }).fill('hanako@example.com');
  await page.getByLabel('メールアドレス（確認）').fill('hanako@example.org');
  await page.getByLabel('電話番号').fill('090-2222-3333');
  await page.getByRole('button', { name: '予約を確定する' }).click();

  // Next.js のルートアナウンサーも role=alert を持つため、文言で絞り込む
  await expect(page.getByRole('alert').filter({ hasText: '確認用のメールアドレスが一致しません' })).toBeVisible();
  await expect(page.getByLabel('お名前')).toHaveValue('那覇 花子');
});

test('予約確認ページは推測できない URL で守られている', async ({ page }) => {
  const response = await page.goto('/ja/bookings/invalid-token');
  expect(response?.status()).toBe(404);
});
