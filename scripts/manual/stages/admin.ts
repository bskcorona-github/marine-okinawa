/**
 * 組合の管理画面（パソコン）。お客様の申込・事業者の回答と交互に進むものは story.ts でつなぐ
 */
import type { Browser, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { BASE, capture, jstDate, loadState, loginAdmin, newPage, panel, saveState, submitTotp } from '../env';

export async function adminPage(browser: Browser): Promise<Page> {
  const page = await newPage(browser, 'desktop');
  await loginAdmin(page);
  return page;
}

export async function adminLogin(browser: Browser) {
  const page = await newPage(browser, 'desktop');
  await page.goto(`${BASE}/admin/login`);
  await page.getByLabel('メールアドレス').fill(process.env.SEED_ADMIN_EMAIL!);
  await page.getByLabel('パスワード').fill(process.env.SEED_ADMIN_PASSWORD!);
  const login = page.getByRole('button', { name: 'ログイン' });
  await capture(page, 'admin-login', 1, {
    marks: [page.getByLabel('メールアドレス'), page.getByLabel('パスワード'), login],
  });
  await login.click();
  const code = page.getByLabel('認証アプリの 6 桁のコード');
  await code.waitFor();
  await code.fill('123456');
  await capture(page, 'admin-login', 2, { marks: [code, page.getByRole('button', { name: '確認' })] });
  await submitTotp(page, readFileSync('.tmp/review-totp.txt', 'utf8').trim());
  await page.getByRole('heading', { name: 'ダッシュボード', level: 1 }).waitFor();
  await capture(page, 'admin-login', 3, { marks: [page.getByRole('region', { name: '要対応' })] });
  await capture(page, 'admin-login', 4, {
    marks: [page.getByRole('navigation', { name: '管理メニュー' }), page.getByRole('button', { name: 'ログアウト' })],
    labels: ['4-1', '4-2'],
    focus: page.getByRole('navigation', { name: '管理メニュー' }),
  });
  await page.context().close();
}

/** 申込の内容と、自動で送った受入確認を確かめる（事業者の回答は、回答のあとに撮る） */
export async function adminNewRequest(browser: Browser) {
  const { bookingNo } = loadState();
  const page = await adminPage(browser);
  const bookingId = await findBookingId(page, bookingNo!);
  await page.goto(`${BASE}/admin`);
  const item = page.locator(`a[href^="/admin/bookings/${bookingId}"]`).first();
  await capture(page, 'admin-new-request', 1, { marks: [item] });
  await item.click();
  await page.waitForURL(/\/admin\/bookings\/[0-9a-f-]{36}/);
  await page.getByRole('heading', { name: new RegExp(`予約 ${bookingNo}`), level: 1 }).waitFor();
  saveState({ adminBookingUrl: page.url().split('?')[0] });
  await capture(page, 'admin-new-request', 2, {
    marks: [panel(page, '予約内容'), panel(page, 'お客様からの申込内容')],
    labels: ['2-1', '2-2'],
  });
  await capture(page, 'admin-new-request', 3, { marks: [panel(page, '事業者への受入確認')] });
  await page.context().close();
}

/** 予約番号から管理画面の予約の id を探す */
export async function findBookingId(page: Page, bookingNo: string): Promise<string> {
  await page.goto(`${BASE}/admin/bookings?q=${bookingNo}`);
  const href = await page
    .locator('main a[href^="/admin/bookings/"]')
    .filter({ hasText: bookingNo })
    .first()
    .getAttribute('href');
  const id = href?.match(/[0-9a-f-]{36}/)?.[0];
  if (!id) throw new Error(`予約 ${bookingNo} が見つかりません`);
  return id;
}

/**
 * 事業者の受入可のあとに支払待ちになっている予約を開き、入金を確かめて確定する。
 * あいだに、お客様の予約確認ページ（支払いの案内・確定・当日の案内・領収書）を撮る
 */
export async function adminPayment(browser: Browser) {
  const { adminBookingUrl, bookingUrl } = loadState();
  const page = await adminPage(browser);
  await page.goto(adminBookingUrl!);
  await capture(page, 'admin-new-request', 4, { marks: [panel(page, '事業者への受入確認')] });

  const awaitingHeading = page.getByRole('heading', { level: 1 }).filter({ hasText: '支払待ち' });
  await awaitingHeading.waitFor();
  await capture(page, 'admin-payment', 1, { marks: [awaitingHeading] });
  const paymentPanel = panel(page, '入金・返金');
  await capture(page, 'admin-payment', 2, { marks: [paymentPanel] });
  await capture(page, 'admin-payment', 3, { marks: [paymentPanel] });

  const customer = await newPage(browser, 'mobile');
  await customer.goto(bookingUrl!);
  await capture(customer, 'customer-booking-page', 2, {
    marks: [customer.locator('section[aria-labelledby="payment-title"]')],
  });

  const confirm = page.getByRole('button', { name: '入金を確認して確定する' });
  await capture(page, 'admin-payment', 4, { marks: [confirm] });
  await confirm.click();
  const dialog = page.getByRole('dialog');
  const amount = dialog.getByLabel('入金額（円）');
  await amount.waitFor();
  const confirmInDialog = dialog.getByRole('button', { name: '入金を確認して確定する' });
  await capture(page, 'admin-payment', 5, {
    marks: [amount, dialog.locator('input[name="paymentReceivedOn"]'), confirmInDialog],
    labels: ['5-1', '5-1', '5-2'],
    focus: amount,
  });
  await confirmInDialog.click();
  const confirmed = page.getByText('入金を記録し、予約を確定しました。').first();
  await confirmed.waitFor();
  await capture(page, 'admin-payment', 6, {
    marks: [confirmed, page.getByRole('list', { name: '予約の進み具合' })],
  });
  await page.context().close();

  await customer.reload();
  const done = customer.locator('section[aria-labelledby="done-title"]').first();
  await capture(customer, 'customer-booking-page', 3, { marks: [done.getByRole('heading', { level: 1 })] });
  const meeting = customer.getByText('集合場所', { exact: true }).first().locator('xpath=ancestor::section[1]');
  await capture(customer, 'customer-booking-page', 4, { marks: [meeting] });
  await capture(customer, 'customer-booking-page', 5, {
    marks: [customer.getByRole('link', { name: 'カレンダーに追加' })],
  });
  const receipt = customer.getByRole('link', { name: '領収書を表示する' });
  await receipt.click();
  await customer.waitForURL(/\/receipt$/);
  await capture(customer, 'customer-booking-page', 6, { marks: [customer.getByRole('button', { name: /印刷する/ })] });
  await customer.context().close();
}

/** 手動予約で使うプランを選ぶ（選択肢の文言にプランの名前が入っている） */
async function selectPlan(page: Page, name: string) {
  const value = await page
    .getByLabel('プラン')
    .locator('option')
    .filter({ hasText: name })
    .first()
    .getAttribute('value');
  await page.getByLabel('プラン').selectOption(value!);
}

/** 電話で受けた予約を、入金済みの予約確定で入れる（取消と返金の手順で使う） */
export async function adminManualBooking(browser: Browser) {
  const page = await adminPage(browser);
  await page.goto(`${BASE}/admin/bookings/new`);
  await selectPlan(page, 'パラセーリング（高さ100m');
  // 4 日後（キャンセル料がかかる日。取消と返金の手順でキャンセル料の計算を見せる）
  await page.getByLabel('日付').fill(jstDate(4));
  const show = page.getByRole('button', { name: '回を表示' });
  await capture(page, 'admin-manual-booking', 1, {
    marks: [page.getByLabel('プラン'), page.getByLabel('日付'), show],
  });
  await show.click();
  await page.waitForURL(/date=/);
  const slot = page.locator('a[href*="/admin/bookings/new?slot="]').filter({ hasText: '10:30' }).first();
  await capture(page, 'admin-manual-booking', 2, { marks: [slot] });
  await slot.click();
  await page.waitForURL(/slot=/);
  await page.getByRole('button', { name: '高さ200m（県内最長）を1名増やす' }).click();
  await page.getByRole('button', { name: '高さ200m（県内最長）を1名増やす' }).click();
  await capture(page, 'admin-manual-booking', 3, {
    marks: [page.getByRole('group', { name: '受付経路' }), page.getByRole('group', { name: '人数' })],
  });
  await page.getByRole('radio', { name: /^予約確定/ }).check();
  const checked = page.getByRole('checkbox', { name: /実施事業者に受入を確認しました/ });
  await checked.check();
  await page.locator('#paymentAmount').waitFor();
  await capture(page, 'admin-manual-booking', 4, {
    marks: [
      page.getByRole('group', { name: '登録する状態' }),
      checked.locator('xpath=ancestor::label[1]'),
      page.locator('#paymentAmount'),
      page.locator('#paymentReceivedOn'),
    ],
    labels: ['4-1', '4-2', '4-3', '4-3'],
    focus: checked,
  });
  await page.locator('#name').fill('宮城 さくら');
  await page.locator('#phone').fill('090-4567-8901');
  const submit = page.getByRole('button', { name: '予約を登録' });
  await capture(page, 'admin-manual-booking', 5, {
    marks: [page.getByRole('group', { name: '代表者' }), submit],
    labels: ['5-1', '5-2'],
    focus: submit,
  });
  await submit.click();
  await page.waitForURL(/\/admin\/bookings\/[0-9a-f-]{36}\?/);
  const created = page.getByText('予約を登録しました。').first();
  await capture(page, 'admin-manual-booking', 6, { marks: [created] });
  saveState({ phoneBookingUrl: page.url().split('?')[0] });
  await page.context().close();
}

/** 電話の予約をお客様の都合で取り消し、キャンセル料を引いて返金する */
export async function adminCancelRefund(browser: Browser) {
  const { phoneBookingUrl } = loadState();
  const page = await adminPage(browser);
  await page.goto(phoneBookingUrl!);
  // 取消・天候中止は「予約をやめるとき」に畳んである
  await page.getByText(/^予約をやめるとき/).click();
  const cancel = page.getByRole('button', { name: '予約を取り消す', exact: true });
  await capture(page, 'admin-cancel-refund', 1, { marks: [cancel] });
  await cancel.click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('select[name="cancelCategory"]').selectOption('customer');
  const due = dialog.getByRole('radiogroup', { name: /返金する割合/ });
  await due.waitFor();
  const confirm = dialog.getByRole('button', { name: '予約を取り消す', exact: true });
  await capture(page, 'admin-cancel-refund', 2, {
    marks: [dialog.locator('select[name="cancelCategory"]'), due, confirm],
    labels: ['2-1', '2-2', '2-3'],
    focus: due.getByRole('radio').first(),
  });
  await confirm.click();
  await page.getByText('予約を取り消しました。').first().waitFor();
  // 返金が残っている予約は、「次の操作」に返金のボタンが出る
  await capture(page, 'admin-cancel-refund', 3, { marks: [panel(page, '次の操作')] });
  const record = page.getByRole('button', { name: /^返金を記録する/ });
  await capture(page, 'admin-cancel-refund', 4, { marks: [record] });
  await record.click();
  const amount = dialog.getByRole('radiogroup', { name: /今回返す割合/ });
  await amount.waitFor();
  const save = dialog.getByRole('button', { name: '返金を記録する', exact: true });
  await capture(page, 'admin-cancel-refund', 5, {
    marks: [amount, dialog.locator('input[name="refundedOn"]'), save],
    labels: ['5-1', '5-1', '5-2'],
    focus: amount.getByRole('radio').first(),
  });
  await save.click();
  await page.waitForURL(/refunded=/);
  await capture(page, 'admin-cancel-refund', 6, { marks: [panel(page, '入金・返金')] });
  await page.context().close();
}

/** 回の予約をまとめて天候中止にする（中止する回に、手順のための予約を 1 件入れておく） */
export async function adminWeather(browser: Browser) {
  const page = await adminPage(browser);
  // 中止すると回が止まるので、撮り直すたびに 1 日ずつ先の回を使う（7 日後から）
  const date = jstDate(7 + (Number(process.env.MANUAL_WEATHER_SHIFT ?? 0) || 0));
  // 中止する回（16:30）に、電話の予約を 1 件入れておく
  await page.goto(`${BASE}/admin/bookings/new`);
  await selectPlan(page, 'パラセーリング（高さ100m');
  await page.getByLabel('日付').fill(date);
  await page.getByRole('button', { name: '回を表示' }).click();
  await page.waitForURL(/date=/);
  await page.locator('a[href*="/admin/bookings/new?slot="]').filter({ hasText: '16:30' }).first().click();
  await page.waitForURL(/slot=/);
  const slotId = new URL(page.url()).searchParams.get('slot')!;
  await page.getByRole('button', { name: '高さ100mを1名増やす' }).click();
  await page.getByRole('button', { name: '高さ100mを1名増やす' }).click();
  await page.getByRole('button', { name: '高さ100mを1名増やす' }).click();
  await page.getByRole('radio', { name: /^予約確定/ }).check();
  await page.getByRole('checkbox', { name: /実施事業者に受入を確認しました/ }).check();
  await page.locator('#name').fill('新垣 大輔');
  await page.locator('#phone').fill('090-5678-9012');
  await page.getByRole('button', { name: '予約を登録' }).click();
  await page.waitForURL(/\/admin\/bookings\/[0-9a-f-]{36}\?/);

  await page.goto(`${BASE}/admin/timetable?date=${date}&view=day`);
  const cell = page.locator(`a[href^="/admin/slots/${slotId}"]:visible`).first();
  await capture(page, 'admin-weather', 1, {
    marks: [page.getByLabel('日付'), cell],
    labels: ['1-1', '1-2'],
    focus: cell,
  });
  await cell.click();
  await page.waitForURL(/\/admin\/slots\//);
  await capture(page, 'admin-weather', 2, { marks: [panel(page, /^予約者/)] });
  const weather = page.getByRole('button', { name: 'この回の予約を一括で天候中止にする' });
  await weather.click();
  const dialog = page.getByRole('dialog');
  const confirm = dialog.getByRole('button', { name: '天候中止にする' });
  await confirm.waitFor();
  await capture(page, 'admin-weather', 3, { marks: [confirm] });
  await confirm.click();
  await page.waitForURL(/saved=weather/);
  await capture(page, 'admin-weather', 4, { marks: [page.getByText(/件の予約を天候中止/).first()] });
  await page.context().close();
}

/** 登録申請を承認して事業者に登録し、事業者画面のアカウントを発行する（初回ログインの手順で使う） */
export async function adminApplication(browser: Browser) {
  const { applicantName } = loadState();
  const page = await adminPage(browser);
  const tile = page.getByRole('link', { name: /事業者の登録申請/ }).first();
  await capture(page, 'admin-application', 1, { marks: [tile] });
  await page.goto(`${BASE}/admin/operators/applications?status=new`);
  await page
    .getByRole('link', { name: new RegExp(applicantName!) })
    .first()
    .click();
  await page.waitForURL(/\/applications\/[0-9a-f-]{36}$/);
  await capture(page, 'admin-application', 2, {
    marks: [panel(page, '事業者の情報'), panel(page, '提供したいプラン'), panel(page, '添付の資料')],
  });
  const approve = page.getByRole('button', { name: '承認して事業者に登録' });
  await capture(page, 'admin-application', 3, { marks: [approve] });
  await approve.click();
  await page.waitForURL(/\/admin\/operators\/[0-9a-f-]{36}\?saved=approved/);
  const email = `manual-operator-${Date.now()}@example.com`;
  await page.getByLabel('ログイン用メールアドレス').fill(email);
  await page.getByLabel('担当者名').fill('仲村 美香');
  const issue = page.getByRole('button', { name: 'アカウントを発行' });
  await capture(page, 'admin-application', 4, {
    marks: [page.getByLabel('ログイン用メールアドレス'), page.getByLabel('担当者名'), issue],
    focus: issue,
  });
  await issue.click();
  const issued = page.getByText('アカウントを発行しました。');
  await issued.waitFor();
  const code = page.locator('main code').first();
  const password = (await code.textContent())!.trim();
  saveState({ newOperator: { email, password, operatorName: applicantName! } });
  // 仮パスワードは、手順書ではぼかす
  await page.addStyleTag({ content: 'main code { filter: blur(5px); }' });
  await capture(page, 'admin-application', 5, { marks: [code], focus: issued });
  await page.reload();
  await capture(page, 'admin-application', 6, { marks: [panel(page, '事業者画面のアカウント')] });
  await page.context().close();
}

/** 事業者が公開を申請したプランを審査して公開する */
export async function adminPlanReview(browser: Browser) {
  const { planTitle } = loadState();
  const page = await adminPage(browser);
  await page.goto(`${BASE}/admin/menus?review=1`);
  const plan = page.locator('main a[href^="/admin/menus/"]').filter({ hasText: planTitle! }).first();
  await capture(page, 'admin-plan-review', 1, {
    marks: [page.getByRole('link', { name: /^審査待ち/ }), plan],
    labels: ['1-1', '1-2'],
  });
  await plan.click();
  await page.waitForURL(/\/admin\/menus\/[0-9a-f-]{36}/);
  const review = panel(page, '公開の申請');
  await capture(page, 'admin-plan-review', 2, { marks: [review] });
  await review.getByRole('button', { name: /^承認して公開する/ }).click();
  const confirm = page.getByRole('dialog').getByRole('button', { name: 'プランを公開する', exact: true });
  await confirm.waitFor();
  await capture(page, 'admin-plan-review', 3, { marks: [confirm] });
  await confirm.click();
  const done = page.getByText('公開を承認し、プランを公開しました。').first();
  await done.waitFor();
  await capture(page, 'admin-plan-review', 4, { marks: [done, page.getByLabel('公開状態')] });
  await page.context().close();
}

/** プランの説明・料金と、回の設定を直す（ここでは保存しない。どこで直すかを見せる） */
export async function adminPlanEdit(browser: Browser) {
  const page = await adminPage(browser);
  await page.goto(`${BASE}/admin/menus`);
  const plan = page.getByRole('link', { name: /^フライボード/ }).first();
  await capture(page, 'admin-plan-edit', 1, { marks: [plan] });
  await plan.click();
  await page.waitForURL(/\/admin\/menus\/[0-9a-f-]{36}$/);
  await capture(page, 'admin-plan-edit', 2, {
    marks: [panel(page, '料金区分'), page.getByRole('button', { name: '保存', exact: true })],
    labels: ['2-1', '2-2'],
    focus: panel(page, '料金区分'),
  });
  const schedule = page.getByRole('link', { name: '回の設定へ' });
  await capture(page, 'admin-plan-edit', 3, { marks: [schedule] });
  await schedule.click();
  await page.waitForURL(/\/schedule/);
  await capture(page, 'admin-plan-edit', 4, {
    marks: [panel(page, '毎週の回（ルール）'), panel(page, /^特定の日の変更/)],
    labels: ['4-1', '4-2'],
    focus: page.getByRole('button', { name: '毎週の回を追加' }),
  });
  await page.context().close();
}

/** 事業者の催行報告を見て、実績を確認済みにする */
export async function adminVerify(browser: Browser) {
  const page = await adminPage(browser);
  const tile = page.getByRole('link', { name: /実績確認待ち/ }).first();
  await capture(page, 'admin-verify', 1, { marks: [tile] });
  await tile.click();
  await page.waitForURL(/\/admin\/bookings/);
  await page
    .getByRole('link', { name: /比嘉 健太/ })
    .first()
    .click();
  await page.waitForURL(/\/admin\/bookings\/[0-9a-f-]{36}/);
  await capture(page, 'admin-verify', 2, { marks: [panel(page, '事業者の催行報告')] });
  await page.getByRole('button', { name: '実績を確認済みにする' }).click();
  const confirm = page.getByRole('dialog').getByRole('button', { name: '実績を確認済みにする' });
  await confirm.waitFor();
  await capture(page, 'admin-verify', 3, { marks: [confirm] });
  await confirm.click();
  const done = page.getByText('実績を確認済みにしました。').first();
  await done.waitFor();
  await capture(page, 'admin-verify', 4, { marks: [done, page.getByRole('list', { name: '予約の進み具合' })] });
  await page.context().close();
}

/** 先月の精算を作り、確定して振込を記録する */
export async function adminSettlement(browser: Browser) {
  const page = await adminPage(browser);
  const now = new Date();
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const period = `${last.getUTCFullYear()}-${String(last.getUTCMonth() + 1).padStart(2, '0')}`;
  await page.goto(`${BASE}/admin/settlements?period=${period}`);
  await capture(page, 'admin-settlement', 1, {
    marks: [page.getByLabel('月を選ぶ'), page.getByRole('button', { name: 'この月を見る' })],
  });
  const create = page.getByRole('button', { name: /この月の精算を作る|作り直す/ });
  await capture(page, 'admin-settlement', 2, { marks: [create] });
  await create.click();
  await page.waitForLoadState('networkidle');
  const row = page
    .locator('main a[href^="/admin/settlements/"]')
    .filter({ hasText: /ココマリン/ })
    .first();
  await row.waitFor();
  await row.click();
  await page.waitForURL(/\/admin\/settlements\/[0-9a-f-]{36}/);
  await capture(page, 'admin-settlement', 3, { marks: [panel(page, '明細')] });
  await page.getByRole('button', { name: '確定する' }).click();
  const confirm = page.getByRole('dialog').getByRole('button', { name: '確定する' });
  await confirm.waitFor();
  await capture(page, 'admin-settlement', 4, { marks: [confirm] });
  await confirm.click();
  const paid = page.getByRole('button', { name: '振込を記録する…' });
  await paid.waitFor();
  await capture(page, 'admin-settlement', 5, {
    marks: [page.locator('input[name="paidOn"]'), paid],
    labels: ['5-1', '5-2'],
    focus: paid,
  });
  await paid.click();
  await page.getByRole('dialog').getByRole('button', { name: '振込を記録する' }).click();
  await page
    .getByText(/振込済み/)
    .first()
    .waitFor();
  await capture(page, 'admin-settlement', 6, { marks: [page.locator('main h1').first().locator('xpath=..')] });
  await page.context().close();
}

/** お問い合わせを開いて、対応の状況とメモを残す */
export async function adminInquiry(browser: Browser) {
  const page = await adminPage(browser);
  await page.goto(`${BASE}/admin/inquiries?status=new`);
  const item = page.getByRole('link', { name: /宜野湾 一郎/ }).first();
  await capture(page, 'admin-inquiry', 1, {
    marks: [page.getByRole('link', { name: '未対応', exact: true }), item],
    labels: ['1-1', '1-2'],
  });
  await item.click();
  await page.waitForURL(/\/admin\/inquiries\/[0-9a-f-]{36}/);
  await capture(page, 'admin-inquiry', 2, { marks: [panel(page, 'お問い合わせ内容'), panel(page, '連絡先')] });
  await page.getByLabel('対応状況').selectOption('done');
  await page
    .getByLabel('対応メモ（組合用）')
    .fill('10/3 メールで回答。11/15 の 9:00 と 10:30 の 2 回に分けて案内（各 10 名）');
  const save = page.getByRole('button', { name: '保存', exact: true });
  await capture(page, 'admin-inquiry', 3, {
    marks: [page.getByLabel('対応状況'), page.getByLabel('対応メモ（組合用）'), save],
  });
  await save.click();
  await page.waitForURL(/saved=1/);
  await page.goto(`${BASE}/admin/inquiries?status=done`);
  await capture(page, 'admin-inquiry', 4, {
    marks: [page.getByRole('link', { name: /^対応済み/ }), page.getByRole('link', { name: /宜野湾 一郎/ }).first()],
  });
  await page.context().close();
}

/** 日報・集計と、予約台帳の CSV */
export async function adminReports(browser: Browser) {
  const page = await adminPage(browser);
  await page.goto(`${BASE}/admin/reports`);
  await capture(page, 'admin-reports', 1, {
    marks: [
      page.getByLabel('開始日'),
      page.getByLabel('終了日'),
      page.locator('select[name="operator"]'),
      page.getByRole('button', { name: 'この期間で見る' }),
    ],
  });
  await capture(page, 'admin-reports', 2, {
    marks: [page.getByRole('region', { name: /事業者別/ }), page.getByRole('region', { name: '日ごとの集計' })],
    focus: page.getByRole('region', { name: /事業者別/ }),
  });
  await page.goto(`${BASE}/admin/bookings`);
  await capture(page, 'admin-reports', 3, {
    marks: [page.getByRole('searchbox', { name: '予約を検索' }), page.getByRole('group', { name: '参加日' })],
  });
  await capture(page, 'admin-reports', 4, { marks: [page.getByRole('link', { name: 'CSV 出力' })] });
  await page.context().close();
}

/** 操作の記録・メールの送信記録 */
export async function adminLogs(browser: Browser) {
  const page = await adminPage(browser);
  const nav = page.getByRole('navigation', { name: '管理メニュー' }).getByRole('link', { name: '操作の記録' });
  await nav.click();
  await page.waitForURL(/\/admin\/logs/);
  await capture(page, 'admin-logs', 1, {
    marks: [nav, page.locator('main table').first()],
    focus: page.getByRole('heading', { name: '操作の記録', level: 1 }),
  });
  const staff = page.getByRole('link', { name: '組合', exact: true });
  await staff.click();
  await page.waitForURL(/actor=staff/);
  await capture(page, 'admin-logs', 2, { marks: [staff] });
  const details = page.locator('main details').first();
  await details.locator('summary').click();
  await capture(page, 'admin-logs', 3, { marks: [details] });
  const mail = page.getByRole('link', { name: 'メールの送信記録' });
  await mail.click();
  await page.waitForURL(/tab=mail/);
  await capture(page, 'admin-logs', 4, { marks: [mail, page.getByRole('link', { name: 'ログインの記録' })] });
  await page.context().close();
}
