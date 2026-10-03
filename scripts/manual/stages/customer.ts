/**
 * お客様の画面：予約の申込・お問い合わせ（予約確認ページの続きは、組合が状態を進める段階で撮る）
 */
import type { Browser } from '@playwright/test';
import { BASE, capture, jstDate, newPage, saveState } from '../env';

/** 申込に使うプランと日（5 日後の 13:30 の回。前日 18:00 が締切） */
const PLAN = 'ginowan-parasailing';

export async function customerBooking(browser: Browser) {
  const page = await newPage(browser, 'mobile');
  const date = jstDate(5);

  await page.goto(`${BASE}/ja`);
  const plan = page.getByRole('region', { name: 'おすすめ・新着のプラン' }).getByRole('article').first();
  await capture(page, 'customer-booking', 1, { marks: [plan] });

  await page.goto(`${BASE}/ja/menus/${PLAN}?month=${date.slice(0, 7)}#calendar`);
  const day = page.locator(`a[href*="date=${date}"]`).first();
  await capture(page, 'customer-booking', 2, { marks: [day] });

  await day.click();
  await page.waitForURL(new RegExp(`date=${date}`));
  const timetable = page.getByRole('region', { name: /のタイムテーブル/ });
  const slot = timetable.getByRole('link', { name: /^13:30/ });
  await capture(page, 'customer-booking', 3, { marks: [slot], focus: timetable });

  await slot.click();
  await page.waitForURL(/\/book\?slot=/);
  await page.getByRole('button', { name: '高さ150mを1人増やす' }).click();
  await page.getByRole('button', { name: '高さ150mを1人増やす' }).click();
  const party = page.getByRole('group', { name: '人数' });
  await capture(page, 'customer-booking', 4, { marks: [party] });

  const email = `manual-${Date.now()}@example.com`;
  await page.getByLabel('お名前').fill('沖縄 花子');
  await page.getByLabel('メールアドレス', { exact: true }).fill(email);
  await page.getByLabel('メールアドレス（確認）').fill(email);
  await page.getByLabel('電話番号').fill('090-2345-6789');
  await capture(page, 'customer-booking', 5, { marks: [page.getByRole('group', { name: '代表者の連絡先' })] });

  const agree = page.getByRole('checkbox', { name: /同意します/ });
  await agree.check();
  const submit = page.getByRole('button', { name: 'この内容で申し込む' });
  await capture(page, 'customer-booking', 6, {
    marks: [agree.locator('xpath=ancestor::label[1]'), submit],
    labels: ['6-1', '6-2'],
    focus: submit,
  });

  await submit.click();
  await page.waitForURL(/\/ja\/bookings\/[^/]+$/);
  const bookingNo = (await page.locator('p.font-mono').first().textContent())?.trim();
  saveState({ bookingUrl: page.url(), bookingNo });
  await capture(page, 'customer-booking-page', 1, {
    marks: [page.locator('p.font-mono').first(), page.getByText('確定までの流れ').locator('xpath=..')],
    labels: ['1', '1'],
  });
  await page.context().close();
}

export async function customerContact(browser: Browser) {
  const page = await newPage(browser, 'mobile');
  await page.goto(`${BASE}/ja`);
  const link = page.getByRole('navigation', { name: 'フッター' }).getByRole('link', { name: 'お問い合わせ' });
  await capture(page, 'customer-contact', 1, { marks: [link] });

  await link.click();
  await page.waitForURL(/\/ja\/contact/);
  await page.getByRole('radio', { name: '団体・学校・企業のご相談' }).check();
  await page.getByLabel('お名前').fill('宜野湾 一郎');
  await page.getByLabel('メールアドレス').fill(`manual-contact-${Date.now()}@example.com`);
  await page.getByLabel('電話番号').fill('098-000-0000');
  await page
    .getByLabel('お問い合わせ内容')
    .fill('11月に社員旅行で20名ほどでパラセーリングを考えています。2回に分けて参加できますか？');
  await capture(page, 'customer-contact', 2, {
    marks: [page.getByRole('group', { name: 'お問い合わせの種類' }), page.getByLabel('お問い合わせ内容')],
    labels: ['2-1', '2-2'],
    focus: page.getByLabel('お名前'),
  });

  const agree = page.getByRole('checkbox', { name: '個人情報の取扱いに同意します' });
  await agree.check();
  const submit = page.getByRole('button', { name: '送信する' });
  await capture(page, 'customer-contact', 3, {
    marks: [agree.locator('xpath=ancestor::label[1]'), submit],
    labels: ['3-1', '3-2'],
    focus: submit,
  });
  await submit.click();
  await page.getByText('お問い合わせを受け付けました').waitFor();
  await page.context().close();
}
