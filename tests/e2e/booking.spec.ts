import { expect, test } from '@playwright/test';
import { addDays, localDate, monthOf } from '../../src/lib/dates';
import { errorSummaryLink, fieldError } from './form-errors';

// 管理画面の E2E（明日・明後日の回を使う）と重ならない日付を使う
const bookingDate = addDays(localDate(new Date(), 'Asia/Tokyo'), 5);
const dayUrl = `/ja/menus/blue-cave?month=${monthOf(bookingDate)}&date=${bookingDate}`;
// 入力エラーから直して申し込む検証用（上の日の残り枠に影響させない）
const retryDate = addDays(bookingDate, 2);
const retryDayUrl = `/ja/menus/blue-cave?month=${monthOf(retryDate)}&date=${retryDate}`;

test('アクティビティからプランを選び、空きを確認して申し込むと仮受付になる（まだ確定しない）', async ({ page }) => {
  await page.goto('/ja');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('沖縄の海で');
  await page
    .locator('#activities')
    .getByRole('link', { name: /シュノーケル/ })
    .click();
  await expect(page.getByRole('heading', { name: 'シュノーケル', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: /青の洞窟シュノーケル/ }).click();
  await expect(page.getByRole('heading', { name: '青の洞窟シュノーケル', level: 1 })).toBeVisible();
  // 予約確定までは実施事業者の名前を出さない
  await expect(page.getByText('アクアマリン E2E')).toHaveCount(0);

  await page.goto(dayUrl);
  const timetable = page.getByRole('region', { name: /のタイムテーブル/ });
  await expect(timetable.getByText('10:00')).toBeVisible();
  await expect(timetable.getByText('残り5名')).toBeVisible();
  await timetable.getByRole('link', { name: '申し込む' }).click();

  await expect(page.getByRole('heading', { name: 'お申し込み内容の入力' })).toBeVisible();
  await page.getByRole('spinbutton', { name: /大人/ }).fill('2');
  await expect(page.getByTestId('total')).toHaveText('￥10,000');
  await page.getByLabel('お名前').fill('沖縄 太郎');
  await page.getByLabel('メールアドレス', { exact: true }).fill('taro@example.com');
  await page.getByLabel('メールアドレス（確認）').fill('taro@example.com');
  await page.getByLabel('電話番号').fill('090-1234-5678');
  await page.getByLabel('第2希望の日時').fill('翌日の午前');
  await page.getByLabel('ご連絡事項').fill('子供が泳げません');
  await page.getByLabel('参加条件・キャンセル規定・個人情報の取扱いに同意します').check();
  await page.getByRole('button', { name: /この内容で申し込む/ }).click();

  await expect(page.getByRole('heading', { name: 'お申し込みを受け付けました' })).toBeVisible();
  await expect(page.getByText('まだご予約は確定していません')).toBeVisible();
  await expect(page.getByText('予約番号', { exact: true })).toBeVisible();
  await expect(page.getByText('翌日の午前')).toBeVisible();
  await expect(page.getByText('アクアマリン E2E')).toHaveCount(0);
  // 確定前はカレンダーに追加させない
  await expect(page.getByRole('link', { name: 'カレンダーに追加' })).toHaveCount(0);

  // 仮受付の時点で枠を押さえる
  await page.goto(dayUrl);
  await expect(page.getByRole('region', { name: /のタイムテーブル/ }).getByText('残り3名')).toBeVisible();
});

test('確認用メールアドレスが違うとエラーになり、入力は残る。直してすぐ送信すれば申し込める', async ({ page }) => {
  await page.goto(retryDayUrl);
  await page
    .getByRole('region', { name: /のタイムテーブル/ })
    .getByRole('link', { name: '申し込む' })
    .click();
  await page.getByRole('spinbutton', { name: /大人/ }).fill('1');
  await page.getByLabel('お名前').fill('那覇 花子');
  await page.getByLabel('メールアドレス', { exact: true }).fill('hanako@example.com');
  await page.getByLabel('メールアドレス（確認）').fill('hanako@example.org');
  await page.getByLabel('電話番号').fill('090-2222-3333');
  await page.getByRole('button', { name: /この内容で申し込む/ }).click();

  // 送信前にブラウザ側で検証し、該当欄の下にエラーを出す（入力は残る）
  await expect(fieldError(page, '確認用のメールアドレスが一致しません')).toBeVisible();
  await expect(page.getByLabel('メールアドレス（確認）')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByLabel('お名前')).toHaveValue('那覇 花子');
  await expect(page).toHaveURL(/\/book\?/);

  // 確認欄を直してそのまま送信ボタンを押す（エラー表示が消えてボタンがずれても、クリックが外れない）
  await page.getByLabel('メールアドレス（確認）').fill('hanako@example.com');
  await expect(fieldError(page, '確認用のメールアドレスが一致しません')).toBeHidden();
  await page.getByLabel('参加条件・キャンセル規定・個人情報の取扱いに同意します').check();
  await page.getByRole('button', { name: /この内容で申し込む/ }).click();
  await expect(page.getByRole('heading', { name: 'お申し込みを受け付けました' })).toBeVisible();
});

test('空欄のまま送信すると、各欄にエラーを出して最初の欄へ移動する', async ({ page }) => {
  await page.goto(dayUrl);
  await page
    .getByRole('region', { name: /のタイムテーブル/ })
    .getByRole('link', { name: '申し込む' })
    .click();
  await page.getByRole('button', { name: /この内容で申し込む/ }).click();
  await expect(fieldError(page, '人数を1名以上選んでください')).toBeVisible();
  await expect(fieldError(page, 'お名前を入力してください')).toBeVisible();
  // フォームの下にも、欄へ移動できるエラーの一覧を出す
  await expect(errorSummaryLink(page, 'お名前を入力してください')).toBeVisible();
  await expect(
    fieldError(page, '参加条件・キャンセル規定・個人情報の取扱いをご確認のうえ、チェックを入れてください'),
  ).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: /大人/ })).toBeFocused();
});

test('キーワードで探せる。固定ページとお問い合わせフォームが使える', async ({ page }) => {
  await page.goto('/ja');
  await page.getByLabel('キーワードで探す').fill('洞窟');
  await page.getByRole('button', { name: '探す' }).click();
  await expect(page.getByRole('heading', { name: '「洞窟」のプラン' })).toBeVisible();
  await expect(page.getByRole('link', { name: /青の洞窟シュノーケル/ })).toBeVisible();

  await page.goto('/ja/how-to-book');
  await expect(page.getByRole('heading', { name: '予約方法', level: 1 })).toBeVisible();
  await page.goto('/ja/privacy');
  await expect(page.getByRole('heading', { name: 'プライバシーポリシー', level: 1 })).toBeVisible();

  await page.goto('/ja/contact');
  await page.getByRole('radio', { name: '団体・学校・企業のご相談' }).check();
  await page.getByLabel('お名前').fill('学校 先生');
  await page.getByLabel('メールアドレス').fill('teacher@example.com');
  await page.getByLabel('お問い合わせ内容').fill('修学旅行で 40 名の参加を考えています。');
  await page.getByRole('button', { name: '送信する' }).click();
  await expect(page.getByText('個人情報の取扱いをご確認のうえ、チェックを入れてください')).toBeVisible();
  await page.getByLabel('個人情報の取扱いに同意します').check();
  await page.getByRole('button', { name: '送信する' }).click();
  await expect(page.getByRole('heading', { name: 'お問い合わせを受け付けました' })).toBeVisible();
});

test('存在しないページはサイト共通の 404 を表示する', async ({ page }) => {
  const response = await page.goto('/ja/no-such-page');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'ページが見つかりません' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'アクティビティから探す' }).first()).toBeVisible();
});

test('予約確認ページは推測できない URL で守られている', async ({ page }) => {
  const response = await page.goto('/ja/bookings/invalid-token');
  expect(response?.status()).toBe(404);
});
