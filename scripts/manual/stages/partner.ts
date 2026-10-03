/**
 * 事業者画面（スマホ）。組合の操作と交互に進むものは、組合の段階から呼ぶ
 */
import type { Browser, Page } from '@playwright/test';
import { BASE, capture, loadState, loginOperator, newPage, panel, samplePdf, saveState, type Account } from '../env';

export async function partnerPage(browser: Browser, account?: Account): Promise<Page> {
  const page = await newPage(browser, 'mobile');
  await loginOperator(page, account ?? loadState().operator!);
  return page;
}

/** 受入確認に回答する（確定のあとの手順 5・6 は、組合が確定したあとに partnerAfterConfirm で撮る） */
export async function partnerAnswer(browser: Browser) {
  const { bookingNo } = loadState();
  const page = await partnerPage(browser);
  // 依頼の一覧から、今回の予約の依頼を探す（ホームの一覧は日時の順なので、依頼の画面の予約番号で確かめる）
  const links = page.getByRole('link', { name: /回答する/ });
  let target = null;
  for (const link of await links.all()) {
    const href = await link.getAttribute('href');
    if (!href) continue;
    const res = await page.request.get(`${BASE}${href}`);
    if ((await res.text()).includes(bookingNo!)) {
      target = page.locator(`a[href="${href}"]`).first();
      break;
    }
  }
  if (!target) throw new Error(`予約 ${bookingNo} の受入確認が事業者画面にありません`);
  await capture(page, 'partner-answer', 1, { marks: [target] });
  await target.click();
  await page.waitForURL(/\/partner\/requests\/[0-9a-f-]{36}/);
  saveState({ requestUrl: page.url().split('?')[0] });
  const detail = page.getByRole('heading', { name: '受入確認の内容', level: 2 }).locator('xpath=ancestor::section[1]');
  await capture(page, 'partner-answer', 2, { marks: [detail] });

  await page.getByRole('radio', { name: /^受入可/ }).check();
  await page.getByLabel('組合へのメモ（任意）').fill('13:30 の回で受け入れられます。集合は 13:00 にマリーナの受付へ');
  const submit = page.getByRole('button', { name: '回答する' });
  await capture(page, 'partner-answer', 3, {
    marks: [page.getByRole('group', { name: '回答を選んでください' }), submit],
    labels: ['3-1', '3-2'],
    focus: page.getByLabel('組合へのメモ（任意）'),
  });
  await submit.click();
  await page.getByText('回答しました。').waitFor();
  await capture(page, 'partner-answer', 4, { marks: [page.getByText('回答しました。').first()] });
  await page.context().close();
}

/** 組合が予約を確定したあとの、事業者の受入確認の画面と予約の画面 */
export async function partnerAfterConfirm(browser: Browser) {
  const { requestUrl } = loadState();
  const page = await partnerPage(browser);
  await page.goto(`${BASE}/partner/requests`);
  const row = page.locator(`a[href="${new URL(requestUrl!).pathname}"]`).first();
  await capture(page, 'partner-answer', 5, { marks: [row] });
  await page.goto(requestUrl!);
  const bookingLink = page.getByRole('link', { name: /予約の詳細|予約を見る|予約の画面/ }).first();
  await bookingLink.click();
  await page.waitForURL(/\/partner\/bookings\/[0-9a-f-]{36}/);
  const contact = page
    .getByRole('heading', { name: /代表者/, level: 2 })
    .first()
    .locator('xpath=ancestor::section[1]');
  await capture(page, 'partner-answer', 6, { marks: [contact] });
  await page.context().close();
}

/** サイトの登録申請のフォームから、加盟を申請する（組合の承認の手順で使う） */
export async function partnerApply(browser: Browser) {
  const page = await newPage(browser, 'mobile');
  const name = 'ぎのわんマリンサポート';
  const email = `manual-partner-${Date.now()}@example.com`;
  await page.goto(`${BASE}/ja`);
  const link = page.getByRole('link', { name: '事業者の方へ（登録申請）' });
  await capture(page, 'partner-apply', 1, { marks: [link] });
  await link.click();
  await page.waitForURL(/\/ja\/partner\/apply/);
  await page.getByLabel('事業者名（屋号・会社名）').fill(name);
  await page.getByLabel('代表者').fill('仲村 誠');
  await page.getByLabel('担当者のお名前').fill('仲村 美香');
  await page.getByLabel('所在地').fill('沖縄県宜野湾市真志喜4丁目4-1');
  await page.getByLabel('メールアドレス', { exact: true }).fill(email);
  await page.getByLabel('メールアドレス（確認）').fill(email);
  await page.getByLabel('お客様向けの電話番号（予約確定後に表示）').fill('090-6789-0123');
  await page.getByLabel('組合からの緊急連絡先（携帯など・非公開）').fill('090-6789-0124');
  const info = page.getByRole('group', { name: '事業者の情報' });
  await capture(page, 'partner-apply', 2, { marks: [info], focus: page.getByLabel('担当者のお名前') });
  await page
    .getByLabel('プランの内容')
    .fill(
      'SUP 体験／大人 6,000 円・子供 4,000 円／約 90 分／毎日 9:00・13:00／6 歳以上／定員 8 名／宜野湾マリーナ集合',
    );
  await page.getByLabel('組合へのメッセージ').fill('来年の春から掲載をお願いしたいです。');
  await capture(page, 'partner-apply', 3, { marks: [page.getByRole('group', { name: '提供したいプラン' })] });
  const pdf = await samplePdf(browser, 'insurance', '賠償責任保険 証券（見本）');
  await page.locator('input[type="file"]').first().setInputFiles(pdf);
  await capture(page, 'partner-apply', 4, { marks: [page.getByRole('group', { name: '資料の添付' })] });
  const agree = page.getByRole('checkbox', { name: '個人情報の取扱いに同意します' });
  await agree.check();
  const submit = page.getByRole('button', { name: '申請する' });
  await capture(page, 'partner-apply', 5, {
    marks: [agree.locator('xpath=ancestor::label[1]'), submit],
    labels: ['5-1', '5-2'],
    focus: submit,
  });
  await submit.click();
  const done = page.getByText('登録申請を受け付けました');
  await done.waitFor();
  await capture(page, 'partner-apply', 6, { marks: [done.locator('xpath=..')] });
  saveState({ applicantName: name });
  await page.context().close();
}

/** 組合から受け取った仮パスワードで初めてログインし、認証アプリの設定とパスワードの変更をする */
export async function partnerFirstLogin(browser: Browser) {
  const account = loadState().newOperator!;
  const page = await newPage(browser, 'mobile');
  await page.goto(`${BASE}/admin/login`);
  await page.getByLabel('メールアドレス').fill(account.email);
  await page.getByLabel('パスワード').fill(account.password);
  const login = page.getByRole('button', { name: 'ログイン' });
  await capture(page, 'partner-first-login', 1, {
    marks: [page.getByLabel('メールアドレス'), page.getByLabel('パスワード'), login],
  });
  await login.click();
  const again = page.getByLabel('パスワードを再入力');
  await again.waitFor();
  await again.fill(account.password);
  await page.getByRole('button', { name: 'QR コードを表示' }).click();
  const secret = page.getByTestId('totp-secret');
  await secret.waitFor();
  // 設定キー・QR コード・バックアップコードは、手順書ではぼかす（読み取れないように）
  await page.addStyleTag({
    content: '[data-testid="totp-secret"], ul.font-mono, div.justify-center > svg { filter: blur(5px); }',
  });
  const qr = page
    .locator('svg')
    .filter({ has: page.locator('path') })
    .first();
  await capture(page, 'partner-first-login', 2, { marks: [qr.locator('xpath=..')], focus: qr });
  account.secret = (await secret.textContent())!.trim();
  await page.getByLabel('バックアップコードを控えました').check();
  const code = page.getByLabel('認証アプリの 6 桁のコード');
  const { generate } = await import('otplib');
  await code.fill(await generate({ secret: account.secret }));
  const finish = page.getByRole('button', { name: '設定を完了する' });
  await capture(page, 'partner-first-login', 3, { marks: [code, finish], focus: code });
  await finish.click();
  const current = page.locator('#currentPassword');
  await current.waitFor();
  const newPassword = `manual-${Date.now()}-Okinawa`;
  await current.fill(account.password);
  await page.locator('#newPassword').fill(newPassword);
  await page.locator('#confirmPassword').fill(newPassword);
  const change = page.getByRole('button', { name: 'パスワードを変更する' });
  await capture(page, 'partner-first-login', 4, {
    marks: [current, page.locator('#newPassword'), page.locator('#confirmPassword'), change],
    focus: page.locator('#newPassword'),
  });
  await change.click();
  await page.waitForURL(/\/partner\?password=changed/);
  account.password = newPassword;
  saveState({ newOperator: account });
  await capture(page, 'partner-first-login', 5, { marks: [page.getByText('パスワードを変更しました。')] });
  await page.goto(`${BASE}/partner/profile`);
  await capture(page, 'partner-first-login', 6, {
    marks: [page.getByRole('heading', { name: '更新の申請', level: 2 }).locator('xpath=ancestor::section[1]')],
  });
  await page.context().close();
}

/**
 * 事業者がプランを登録し、開催時間を決めて公開を申請する（組合の審査の手順で使う）。
 * 登録申請から加わった事業者で撮る（前の撮影で作ったプランが一覧に出ないように）
 */
export async function partnerPlan(browser: Browser) {
  const page = await partnerPage(browser, loadState().newOperator);
  await page.goto(`${BASE}/partner/plans`);
  const add = page.getByRole('link', { name: 'プランを追加' });
  await capture(page, 'partner-plan', 1, { marks: [add] });
  await add.click();
  await page.waitForURL(/\/partner\/plans\/new/);
  const title = 'サンセット SUP 体験（宜野湾マリーナ発）';
  await page.getByLabel(/^プラン名/).fill(title);
  // サイトのアクティビティの分類に SUP はまだないので空のまま。カテゴリは SUP
  await page.getByLabel('種類（一覧のアイコン・色）').selectOption('sup');
  await page.getByLabel(/^所要時間/).fill('90');
  await page.getByLabel(/^対象年齢/).fill('6');
  await page.getByLabel(/^1 予約の最大人数/).fill('8');
  await capture(page, 'partner-plan', 2, {
    marks: [panel(page, '基本情報')],
    focus: page.getByLabel(/^プラン名/),
  });
  await page
    .getByLabel('一覧用の紹介文（短め）')
    .fill('夕日に染まる宜野湾の海を、SUP でのんびりお散歩。初めての方も安心のレクチャー付きです。');
  await page
    .getByLabel('説明文')
    .fill(
      'インストラクターが陸上で立ち方・こぎ方を教えてから海へ出ます。夕方の穏やかな海で、沖縄の夕日を楽しみましょう。',
    );
  await page.getByLabel('集合場所（名称・集合時刻・注意文）').fill('宜野湾マリーナ 受付に 15 分前集合');
  const prices = page.getByLabel(/^料金（円・税込）/);
  await prices.nth(0).fill('6000');
  await prices.nth(1).fill('4000');
  await capture(page, 'partner-plan', 3, { marks: [panel(page, '料金区分')] });
  const save = page.getByRole('button', { name: '下書きを保存して開催時間の登録へ' });
  await capture(page, 'partner-plan', 4, { marks: [save] });
  await save.click();
  await page.waitForURL(/\/partner\/plans\/[0-9a-f-]{36}\/schedule/);
  const planUrl = page.url().replace(/\/schedule.*$/, '');
  saveState({ planTitle: title });
  const ruleForm = page.getByText('毎週の回を追加', { exact: true }).first().locator('xpath=ancestor::form[1]');
  await ruleForm.locator('input[name="startTime"]').fill('16:30');
  await ruleForm.locator('input[name="capacity"]').fill('8');
  const addRule = ruleForm.getByRole('button', { name: '毎週の回を追加' });
  await capture(page, 'partner-plan', 5, { marks: [ruleForm], focus: ruleForm.locator('input[name="startTime"]') });
  await addRule.click();
  await page.getByText('保存し、今後 180 日分の回に反映しました。').waitFor();
  await page.goto(planUrl);
  const request = page.getByRole('button', { name: '公開を申請する' });
  await capture(page, 'partner-plan', 6, { marks: [request] });
  await request.click();
  await page.waitForURL(/publish_requested|done=/);
  await page.context().close();
}

/** 先月の予約に催行報告を送る（組合の実績の確認の手順で使う） */
export async function partnerReport(browser: Browser) {
  const page = await partnerPage(browser);
  await page.goto(`${BASE}/partner/bookings`);
  const row = page.locator('section[aria-labelledby="awaiting-title"] a').filter({ hasText: '比嘉 健太' }).first();
  await capture(page, 'partner-report', 1, { marks: [row] });
  await row.click();
  await page.waitForURL(/\/partner\/bookings\/[0-9a-f-]{36}/);
  await page.getByRole('radio', { name: /^実施した/ }).check();
  await page.locator('input[name="actualPartySize"]').fill('2');
  await capture(page, 'partner-report', 2, {
    marks: [page.getByRole('group', { name: '結果を選んでください' }), page.locator('input[name="actualPartySize"]')],
    labels: ['2-1', '2-2'],
    focus: page.locator('input[name="actualPartySize"]'),
  });
  const send = page.locator('#report').getByRole('button', { name: /報告/ });
  await capture(page, 'partner-report', 3, { marks: [send] });
  await send.click();
  await page.getByText('催行報告を送りました。').waitFor();
  await page.context().close();
}

/** 確定した精算を、事業者画面で確かめる */
export async function partnerSettlement(browser: Browser) {
  const page = await partnerPage(browser);
  await page.goto(`${BASE}/partner/settlements`);
  const row = page.locator('main a[href^="/partner/settlements/"]').first();
  await capture(page, 'partner-settlement', 1, { marks: [row] });
  await row.click();
  await page.waitForURL(/\/partner\/settlements\/[0-9a-f-]{36}/);
  const table = page.locator('main table').first();
  await capture(page, 'partner-settlement', 2, { marks: [table], focus: table });
  await capture(page, 'partner-settlement', 3, { marks: [page.getByText(/組合からお振り込みしました/).first()] });
  await page.context().close();
}

/** 登録申請から加わった事業者が、資料を提出する */
export async function partnerDocuments(browser: Browser) {
  const page = await partnerPage(browser, loadState().newOperator);
  await page.goto(`${BASE}/partner`);
  const nav = page.getByRole('link', { name: '資料' }).first();
  await capture(page, 'partner-documents', 1, { marks: [nav] });
  await nav.click();
  await page.waitForURL(/\/partner\/documents/);
  const kind = page.getByLabel('種類');
  const insurance = await kind.locator('option').filter({ hasText: '保険' }).first().getAttribute('value');
  if (insurance) await kind.selectOption(insurance);
  await page.getByLabel('資料の名前（必須）').fill('賠償責任保険 証券（2026 年度）');
  const nextYear = new Date().getFullYear() + 1;
  await page.getByLabel('有効期限（あれば）').fill(`${nextYear}-03-31`);
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(await samplePdf(browser, 'insurance', '賠償責任保険 証券（見本）'));
  const form = page.getByRole('heading', { name: '資料を提出する', level: 2 }).locator('xpath=ancestor::section[1]');
  await capture(page, 'partner-documents', 2, { marks: [form], focus: page.getByLabel('資料の名前（必須）') });
  const submit = page.getByRole('button', { name: '提出する' });
  await submit.click();
  await page.getByRole('heading', { name: '提出済みの資料', level: 2 }).waitFor();
  await page.waitForLoadState('networkidle');
  const list = page.getByRole('heading', { name: '提出済みの資料', level: 2 }).locator('xpath=ancestor::section[1]');
  await capture(page, 'partner-documents', 3, { marks: [list] });
  await page.context().close();
}
