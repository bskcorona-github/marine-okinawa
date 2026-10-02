/**
 * 手順書を作る（開発用 DB と開発サーバーに対して、画面を操作しながら撮る）。
 *   npx tsx scripts/manual/build.ts                 … すべての段階を撮って、1 枚の画像とノートにまとめる
 *   npx tsx scripts/manual/build.ts customer-booking … 指定した段階だけ撮り直す（まとめ直しは compose）
 *   npx tsx scripts/manual/build.ts compose          … 撮った画面から、画像とノートだけ作り直す
 * 段階は物語の順（お客様の申込 → 組合の確認 → 事業者の回答 → …）。前の段階で作った予約などを state.json で引き継ぐ
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser } from '@playwright/test';
import { stepImage } from './env';
import { FLOWS, type FlowId } from './flows';
import { compose, writeNote, type Flow } from './lib';
import {
  adminApplication,
  adminCancelRefund,
  adminInquiry,
  adminLogin,
  adminLogs,
  adminManualBooking,
  adminNewRequest,
  adminPayment,
  adminPlanEdit,
  adminPlanReview,
  adminReports,
  adminSettlement,
  adminVerify,
  adminWeather,
} from './stages/admin';
import { customerBooking, customerContact } from './stages/customer';
import {
  partnerAfterConfirm,
  partnerAnswer,
  partnerApply,
  partnerDocuments,
  partnerFirstLogin,
  partnerPlan,
  partnerReport,
  partnerSettlement,
} from './stages/partner';
import { prepare } from './stages/prepare';

/** Obsidian の保管庫（リンクは保管庫からのパスで書く。同じ名前のノート・画像がほかにあっても取り違えないように） */
const VAULT_ROOT = process.env.MANUAL_VAULT_ROOT ?? 'F:/Obsidian/プライベート';
const VAULT_DIR = process.env.MANUAL_VAULT_DIR ?? path.join(VAULT_ROOT, 'プロジェクト/沖縄マリン予約サイト/04_手順書');
const vaultPath = (file: string) => path.relative(VAULT_ROOT, file).split(path.sep).join('/');
const AUDIENCES = ['お客様', '組合', '事業者'] as const;

/** 物語の順。前の段階で作ったもの（予約・アカウントなど）を、あとの段階で使う */
const STAGES: Record<string, (browser: Browser) => Promise<void>> = {
  prepare,
  'customer-booking': customerBooking,
  'customer-contact': customerContact,
  'admin-login': adminLogin,
  'admin-new-request': adminNewRequest,
  'partner-answer': partnerAnswer,
  'admin-payment': adminPayment,
  'partner-after-confirm': partnerAfterConfirm,
  'admin-manual-booking': adminManualBooking,
  'admin-cancel-refund': adminCancelRefund,
  'admin-weather': adminWeather,
  'partner-apply': partnerApply,
  'admin-application': adminApplication,
  'partner-first-login': partnerFirstLogin,
  'partner-documents': partnerDocuments,
  'partner-plan': partnerPlan,
  'admin-plan-review': adminPlanReview,
  'admin-plan-edit': adminPlanEdit,
  'partner-report': partnerReport,
  'admin-verify': adminVerify,
  'admin-settlement': adminSettlement,
  'partner-settlement': partnerSettlement,
  'admin-inquiry': adminInquiry,
  'admin-reports': adminReports,
  'admin-logs': adminLogs,
};

/** 1 枚の画像とノートにまとめる（撮っていない手順があれば、その流れは飛ばして知らせる） */
async function composeAll(browser: Browser) {
  const done: { flow: Flow; file: string }[] = [];
  for (const [id, def] of Object.entries(FLOWS) as [FlowId, (typeof FLOWS)[FlowId]][]) {
    const steps = def.steps.map((s, i) => ({ ...s, image: stepImage(id, i + 1) }));
    const missing = steps.filter((s) => !existsSync(s.image)).map((s) => path.basename(s.image));
    if (missing.length) {
      console.warn(`skip ${id}（まだ撮っていない手順：${missing.join(', ')}）`);
      continue;
    }
    const flow: Flow = { id, ...def, steps };
    const dir = path.join(VAULT_DIR, def.audience);
    const image = path.join(dir, 'images', `${def.title}.png`);
    await compose(browser, flow, image);
    writeNote(flow, vaultPath(image), path.join(dir, `${def.title}.md`));
    done.push({ flow, file: vaultPath(path.join(dir, def.title)) });
  }
  writeIndex(done);
}

/** 手順書の一覧のノート（利用者ごとに、流れの名前とひとことを並べる） */
function writeIndex(flows: { flow: Flow; file: string }[]) {
  const lines = [
    '---',
    'tags: [沖縄マリン予約サイト, 手順書]',
    `updated: ${new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date())}`,
    '---',
    '# 手順書の一覧',
    '',
    '画面の流れ 1 つにつき 1 枚の画像にまとめた手順書です。番号のついた青い枠が、その手順で操作する場所です。',
    '画像は開発用のデータで撮っています（`scripts/manual/build.ts` で撮り直せます）。',
    '',
  ];
  for (const audience of AUDIENCES) {
    const items = flows.filter((f) => f.flow.audience === audience);
    if (!items.length) continue;
    lines.push(`## ${audience}向け`, '');
    for (const { flow, file } of items) lines.push(`- [[${file}|${flow.title}]] — ${flow.lead ?? ''}`);
    lines.push('');
  }
  mkdirSync(VAULT_DIR, { recursive: true });
  writeFileSync(path.join(VAULT_DIR, '手順書の一覧.md'), lines.join('\n'), 'utf8');
}

(async () => {
  const only = process.argv.slice(2);
  const unknown = only.filter((s) => s !== 'compose' && !STAGES[s]);
  if (unknown.length) throw new Error(`知らない段階：${unknown.join(', ')}（${Object.keys(STAGES).join(', ')}）`);
  const browser = await chromium.launch();
  try {
    const stages = only.length ? only.filter((s) => s !== 'compose') : Object.keys(STAGES);
    for (const name of stages) {
      console.info(`== ${name}`);
      await STAGES[name](browser);
    }
    if (!only.length || only.includes('compose')) await composeAll(browser);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
