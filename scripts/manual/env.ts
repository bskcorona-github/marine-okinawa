/**
 * 手順書の撮影の共通部分：画面の大きさ・ログイン・段階をまたいで使う値（予約の URL・事業者のアカウント）
 * 撮影は開発用の DB と開発サーバー（npm run dev）に対して行う
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  devices,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from '@playwright/test';
import { config } from 'dotenv';
import { generate } from 'otplib';
import { shot } from './lib';
import { FLOWS, type FlowId } from './flows';

config({ path: '.env.local', override: true, quiet: true });

export const BASE = process.env.MANUAL_BASE_URL ?? 'http://localhost:3000';
export const WORK_DIR = '.tmp/manual';
export const SHOTS_DIR = `${WORK_DIR}/shots`;
const STATE_FILE = `${WORK_DIR}/state.json`;
const ADMIN_TOTP_FILE = '.tmp/review-totp.txt';

const VIEWPORTS: Record<'mobile' | 'desktop', BrowserContextOptions> = {
  mobile: { ...devices['iPhone 13'], deviceScaleFactor: 2, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' },
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' },
};

export async function newPage(browser: Browser, device: 'mobile' | 'desktop'): Promise<Page> {
  const context: BrowserContext = await browser.newContext(VIEWPORTS[device]);
  return context.newPage();
}

/**
 * 手順の画面を撮る（flows.ts の手順の番号に合わせたファイル名で保存する）。
 * 枠の番号は手順の番号（1 つの手順で順に操作する場所が複数あるときは labels で「6-1」「6-2」のように付ける）
 */
export async function capture(
  page: Page,
  flowId: FlowId,
  step: number,
  options: Parameters<typeof shot>[2] = {},
): Promise<void> {
  const flow = FLOWS[flowId];
  if (!flow.steps[step - 1]) throw new Error(`${flowId} に ${step} 番目の手順がありません`);
  const labels = options.labels ?? options.marks?.map(() => String(step));
  await shot(page, stepImage(flowId, step), { ...options, labels });
}

/** 見出し（h2）のついた枠（管理画面・事業者画面の Panel） */
export function panel(page: Page, title: string | RegExp): Locator {
  return page.getByRole('heading', { name: title, level: 2 }).first().locator('xpath=ancestor::section[1]');
}

export const stepImage = (flowId: FlowId, step: number) =>
  path.join(SHOTS_DIR, `${flowId}-${String(step).padStart(2, '0')}.png`);

// ---- 段階をまたいで使う値 ----

export type Account = { email: string; password: string; secret?: string; operatorName: string };

export type State = {
  /** お客様が申し込んだ予約（受入確認 → 支払案内 → 確定へ進める） */
  bookingUrl?: string;
  bookingNo?: string;
  /** その予約の管理画面の URL */
  adminBookingUrl?: string;
  /** 事業者画面の受入確認の URL */
  requestUrl?: string;
  /** 電話で受けた予約（取消と返金の手順で使う）の管理画面の URL */
  phoneBookingUrl?: string;
  /** 受入確認に回答する事業者（ココマリン）のアカウント */
  operator?: Account;
  /** 登録申請から加わった事業者のアカウント（初回ログインの手順で使う） */
  newOperator?: Account;
  /** 登録申請の事業者名 */
  applicantName?: string;
  /** 事業者が登録したプランの名前（組合の審査で使う） */
  planTitle?: string;
};

export function loadState(): State {
  return existsSync(STATE_FILE) ? (JSON.parse(readFileSync(STATE_FILE, 'utf8')) as State) : {};
}

export function saveState(patch: Partial<State>): State {
  const next = { ...loadState(), ...patch };
  mkdirSync(WORK_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(next, null, 2));
  return next;
}

// ---- ログイン ----

/** ログインの画面でメール・パスワードを入れて送る（2 要素認証の画面の手前まで） */
export async function submitLogin(page: Page, email: string, password: string) {
  await page.goto(`${BASE}/admin/login`);
  await page.getByLabel('メールアドレス').fill(email);
  await page.getByLabel('パスワード').fill(password);
  await page.getByRole('button', { name: 'ログイン' }).click();
}

/** 2 要素認証のコードを入れて送る */
export async function submitTotp(page: Page, secret: string) {
  await page.getByLabel('認証アプリの 6 桁のコード').fill(await generate({ secret }));
  await page.getByRole('button', { name: '確認' }).click();
}

/** 組合の管理者でログインする（2 要素認証の秘密鍵は、画面の撮影のときに設定したものを使う） */
export async function loginAdmin(page: Page) {
  const secret = readFileSync(ADMIN_TOTP_FILE, 'utf8').trim();
  await submitLogin(page, process.env.SEED_ADMIN_EMAIL!, process.env.SEED_ADMIN_PASSWORD!);
  await page.getByLabel('認証アプリの 6 桁のコード').waitFor();
  await submitTotp(page, secret);
  await page.getByRole('heading', { name: 'ダッシュボード', level: 1 }).waitFor();
}

/** 事業者でログインする（2 要素認証の設定・パスワードの変更が済んだアカウント） */
export async function loginOperator(page: Page, account: Account) {
  if (!account.secret) throw new Error(`${account.email} の 2 要素認証の秘密鍵がありません`);
  await submitLogin(page, account.email, account.password);
  await page.getByLabel('認証アプリの 6 桁のコード').waitFor();
  await submitTotp(page, account.secret);
  await page.getByRole('heading', { name: 'ホーム', level: 1 }).waitFor();
}

/** YYYY-MM-DD（日本時間で今日から days 日後） */
export function jstDate(days: number): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date(Date.now() + days * 86_400_000));
}

/** 添付用の見本の PDF（資料の提出・登録申請の手順で使う） */
export async function samplePdf(browser: Browser, name: string, title: string): Promise<string> {
  const file = path.join(WORK_DIR, 'files', `${name}.pdf`);
  if (existsSync(file)) return file;
  mkdirSync(path.dirname(file), { recursive: true });
  const page = await browser.newPage();
  await page.setContent(
    `<html lang="ja"><body style="font-family:sans-serif;padding:48px"><h1>${title}</h1><p>（手順書の撮影用の見本です）</p></body></html>`,
  );
  await page.pdf({ path: file, format: 'A4' });
  await page.close();
  return file;
}
