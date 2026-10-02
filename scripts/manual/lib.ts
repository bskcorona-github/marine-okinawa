/**
 * 手順書（画面の流れごとの 1 枚の画像）を作る道具。
 * - shot：画面の操作する場所に青い枠と番号を重ねて撮る（撮ったら枠は消す）
 * - compose：撮った画面を、番号つきの手順のカード（見出し・ひとこと・画面）にして 1 枚の画像にまとめる
 * 撮影は開発用の DB に対して行う（手順を進めるとデータが変わる）
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Browser, Locator, Page } from '@playwright/test';

export type Step = {
  /** 手順の見出し（例：「新規依頼」を開く） */
  title: string;
  /** ひとこと（1〜2 文） */
  text: string;
  /** 撮った画面の画像 */
  image: string;
};

export type Flow = {
  /** ファイル名にも使う（英数字） */
  id: string;
  /** 1 枚の画像の見出し（例：予約を申し込む） */
  title: string;
  /** 誰が使う画面か */
  audience: 'お客様' | '組合' | '事業者';
  /** 画像の上に出す説明（任意） */
  lead?: string;
  steps: Step[];
  /** スマホの画面（3 列）か、パソコンの画面（2 列）か */
  device: 'mobile' | 'desktop';
};

const OVERLAY_CLASS = '__manual_overlay__';

/**
 * 操作する場所に枠と番号を重ねて、画面を撮る。marks の 1 つ目が画面に入るようにスクロールしてから撮る
 * （番号は labels の順。なければ 1, 2, 3…）。focus を渡すと、その要素が画面の中央に来るようにする
 */
export async function shot(
  page: Page,
  file: string,
  options: { marks?: Locator[]; labels?: string[]; focus?: Locator; fullPage?: boolean } = {},
): Promise<string> {
  const marks = options.marks ?? [];
  const labels = marks.map((_, i) => options.labels?.[i] ?? String(i + 1));
  await page.waitForLoadState('networkidle').catch(() => undefined);
  // 開発サーバーの表示（Next.js の開発用のボタン）は写さない
  await page.evaluate(() =>
    document
      .querySelectorAll('nextjs-portal')
      .forEach((el) => (el as HTMLElement).style.setProperty('display', 'none', 'important')),
  );
  const anchor = options.focus ?? marks[0];
  if (anchor && !options.fullPage) {
    // サイトはなめらかにスクロールする設定なので、すぐに移す（途中で撮らないように）
    await anchor.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
  }
  // 固定ヘッダーなどの描き直しを待つ
  await page.waitForTimeout(250);
  const boxes: { x: number; y: number; width: number; height: number }[] = [];
  for (const mark of marks) {
    const box = await mark.boundingBox();
    if (!box) throw new Error(`枠を付ける要素が画面にありません（${file}）`);
    boxes.push(box);
  }
  await page.evaluate(
    ({ boxes, labels, cls, fullPage }) => {
      // 画面に固定した層（ポップオーバー）に描く：開いているダイアログ（最前面の層）よりも前に出すため。
      // ページ全体を撮るときは、ページの中に重ねる（スクロールした位置に合わせる）
      const layer = document.createElement('div');
      layer.className = cls;
      const offsetX = fullPage ? window.scrollX : 0;
      const offsetY = fullPage ? window.scrollY : 0;
      if (fullPage) {
        Object.assign(layer.style, { position: 'absolute', left: '0', top: '0', width: '0', height: '0' });
        document.body.append(layer);
      } else {
        layer.setAttribute('popover', 'manual');
        Object.assign(layer.style, {
          position: 'fixed',
          inset: '0',
          width: '100vw',
          height: '100vh',
          margin: '0',
          padding: '0',
          border: '0',
          background: 'transparent',
          overflow: 'visible',
          pointerEvents: 'none',
        });
        document.body.append(layer);
        layer.showPopover();
      }
      boxes.forEach((b, i) => {
        const pad = 4;
        const frame = document.createElement('div');
        Object.assign(frame.style, {
          position: 'absolute',
          left: `${b.x + offsetX - pad}px`,
          top: `${b.y + offsetY - pad}px`,
          width: `${b.width + pad * 2}px`,
          height: `${b.height + pad * 2}px`,
          border: '3px solid #1a66e0',
          borderRadius: '10px',
          boxShadow: '0 0 0 4px rgba(26,102,224,0.18)',
          boxSizing: 'border-box',
          zIndex: '2147483646',
          pointerEvents: 'none',
        });
        const badge = document.createElement('div');
        badge.textContent = labels[i];
        Object.assign(badge.style, {
          position: 'absolute',
          left: `${Math.max(offsetX + 2, b.x + offsetX - pad - 13)}px`,
          top: `${Math.max(offsetY + 2, b.y + offsetY - pad - 13)}px`,
          minWidth: '26px',
          height: '26px',
          padding: '0 7px',
          boxSizing: 'border-box',
          borderRadius: '9999px',
          background: '#1a66e0',
          color: '#fff',
          font: '700 15px/26px system-ui, sans-serif',
          textAlign: 'center',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
          zIndex: '2147483647',
          pointerEvents: 'none',
        });
        layer.append(frame, badge);
      });
    },
    { boxes, labels, cls: OVERLAY_CLASS, fullPage: options.fullPage ?? false },
  );
  mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, fullPage: options.fullPage ?? false, type: 'png' });
  await page.evaluate((cls) => document.querySelectorAll(`.${cls}`).forEach((el) => el.remove()), OVERLAY_CLASS);
  console.info(`  shot ${path.basename(file)}`);
  return file;
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const dataUri = (file: string) => `data:image/png;base64,${readFileSync(file).toString('base64')}`;

/** 手順のカードを並べた 1 枚の HTML（お手本：番号・見出し・ひとこと・画面のカードを格子に並べる） */
function flowHtml(flow: Flow): string {
  const columns = flow.device === 'mobile' ? 3 : 2;
  const cards = flow.steps
    .map(
      (s, i) => `
      <section class="card">
        <h2><span class="num">${i + 1}</span>${escapeHtml(s.title)}</h2>
        <p>${escapeHtml(s.text)}</p>
        <div class="screen"><img src="${dataUri(s.image)}" alt=""></div>
      </section>`,
    )
    .join('');
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 48px 48px 56px; width: 1600px; background: #fff; color: #1b1f24;
      font-family: 'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic UI', 'Meiryo', system-ui, sans-serif; }
    .bars { display: flex; gap: 8px; margin-bottom: 36px; }
    .bars span { height: 8px; border-radius: 4px; }
    .who { display: inline-block; margin: 0 0 10px; padding: 4px 14px; border-radius: 999px; background: #e7f6f5;
      color: #0b6b66; font-weight: 700; font-size: 20px; }
    h1 { margin: 0 0 12px; font-size: 56px; font-weight: 900; letter-spacing: 0.02em; }
    .lead { margin: 0 0 32px; font-size: 22px; color: #4a5560; line-height: 1.6; }
    .grid { display: grid; grid-template-columns: repeat(${columns}, 1fr); gap: 20px; align-items: start; }
    .card { border: 2px solid #e3e6ea; border-radius: 18px; padding: 18px 18px 16px; }
    .card h2 { display: flex; align-items: center; gap: 12px; margin: 0 0 8px; font-size: 27px; font-weight: 800; }
    .num { flex: none; width: 40px; height: 40px; border-radius: 999px; background: #0b7f79; color: #fff;
      display: inline-flex; align-items: center; justify-content: center; font-size: 22px; }
    .card p { margin: 0 0 14px; font-size: 19px; line-height: 1.6; color: #4a5560; min-height: 3.2em; }
    .screen { border: 2px solid #e3e6ea; border-radius: 12px; overflow: hidden; background: #f6f7f9; }
    .screen img { display: block; width: 100%; height: auto; }
  </style></head><body>
    <div class="bars"><span style="width:104px;background:#13b5b1"></span><span style="width:44px;background:#ef5350"></span><span style="width:20px;background:#d9dde2"></span></div>
    <p class="who">${escapeHtml(flow.audience)}向け</p>
    <h1>${escapeHtml(flow.title)}</h1>
    ${flow.lead ? `<p class="lead">${escapeHtml(flow.lead)}</p>` : ''}
    <div class="grid">${cards}</div>
  </body></html>`;
}

/** 手順のカードを 1 枚の画像にする */
export async function compose(browser: Browser, flow: Flow, outFile: string): Promise<string> {
  // 2 倍の解像度でまとめる（Obsidian で拡大したときに、画面の文字が読めるように）
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  await page.setContent(flowHtml(flow), { waitUntil: 'load' });
  mkdirSync(path.dirname(outFile), { recursive: true });
  await page.screenshot({ path: outFile, fullPage: true, type: 'png' });
  await page.close();
  console.info(`composed ${path.basename(outFile)}`);
  return outFile;
}

/** Obsidian のノート（画像と、検索できるように手順を文字でも書く）。image は保管庫からの画像のパス */
export function writeNote(flow: Flow, image: string, notePath: string) {
  const lines = [
    '---',
    `tags: [沖縄マリン予約サイト, 手順書, ${flow.audience}]`,
    'cssclasses: [wide]',
    '---',
    `# ${flow.title}（${flow.audience}向け）`,
    '',
    flow.lead ?? '',
    '',
    `![[${image}]]`,
    '',
    '## 手順',
    '',
    ...flow.steps.map((s, i) => `${i + 1}. **${s.title}** — ${s.text}`),
    '',
  ];
  mkdirSync(path.dirname(notePath), { recursive: true });
  writeFileSync(notePath, lines.join('\n'), 'utf8');
}
