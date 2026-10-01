import { expect, test } from '@playwright/test';
import { addDays, localDate, monthOf } from '../../src/lib/dates';
import { fieldError } from './form-errors';

// 他の E2E と重ならない日付を使う
const date = addDays(localDate(new Date(), 'Asia/Tokyo'), 9);
const dayUrl = `/ja/menus/charter?month=${monthOf(date)}&date=${date}`;

test('貸切プランは出発港と乗船人数を入れて申し込め、追加料金が合計に入る', async ({ page }) => {
  await page.goto(`${dayUrl}&people=12`);
  await page
    .getByRole('region', { name: /のタイムテーブル/ })
    .getByRole('link', { name: /申し込む/ })
    .click();
  await expect(page.getByRole('heading', { name: 'お申し込み内容の入力' })).toBeVisible();

  // 検索の人数が乗船人数に入っている。出発港を選ばずに送るとエラー、乗船人数を消してもエラーになる
  await expect(page.getByLabel('乗船人数')).toHaveValue('12');
  await page.getByLabel('乗船人数').fill('');
  await page.getByRole('button', { name: /この内容で申し込む/ }).click();
  await expect(fieldError(page, 'コース・出発港を選んでください')).toBeVisible();
  await expect(fieldError(page, '乗船人数を1名以上で入力してください')).toBeVisible();

  await page.getByRole('radio', { name: /那覇発/ }).check();
  await expect(page.getByTestId('total')).toHaveText('￥200,000');
  // 基本料金は 10 名まで。12 名なら 2 名分の追加料金が合計に入る
  await page.getByLabel('乗船人数').fill('12');
  await expect(page.getByText('追加の乗船 2名')).toBeVisible();
  await expect(page.getByTestId('total')).toHaveText('￥216,000');
  await page.getByLabel('お名前').fill('団体 太郎');
  await page.getByLabel('メールアドレス', { exact: true }).fill('group@example.com');
  await page.getByLabel('メールアドレス（確認）').fill('group@example.com');
  await page.getByLabel('電話番号').fill('090-7777-8888');
  await page.getByLabel('参加条件・キャンセル規定・個人情報の取扱いに同意します').check();
  await page.getByRole('button', { name: /この内容で申し込む/ }).click();

  await expect(page.getByRole('heading', { name: 'お申し込みを受け付けました' })).toBeVisible();
  await expect(page.getByText('那覇発 1艇')).toBeVisible();
  await expect(page.getByText('12名', { exact: true })).toBeVisible();
  await expect(page.getByText('￥216,000', { exact: true })).toBeVisible();

  // 1 艇だけの回なので、申込（仮受付）の時点で枠を押さえ、満席になる
  await page.goto(dayUrl);
  await expect(page.getByRole('region', { name: /のタイムテーブル/ }).getByText('満席')).toBeVisible();
});
