import type { ReactNode } from 'react';
import { Phrase } from './phrase';

type Block = { type: 'h2' | 'h3' | 'p'; text: string } | { type: 'ul'; items: string[] };

/**
 * 管理画面で書く固定ページの本文を、見出し・段落・箇条書きに分ける。
 * 「## 見出し」「### 小見出し」「- 項目」（「・」も可）、空行で段落を分ける。HTML は使わない（そのまま文字として出す）
 */
export function parseSimpleText(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) blocks.push({ type: 'p', text: paragraph.join('\n') });
    paragraph = [];
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^(#{2,3})\s+(.+)$/.exec(line);
    const item = /^[-・]\s*(.+)$/.exec(line);
    if (!line) {
      flush();
    } else if (heading) {
      flush();
      blocks.push({ type: heading[1].length === 2 ? 'h2' : 'h3', text: heading[2] });
    } else if (item) {
      flush();
      const last = blocks.at(-1);
      if (last?.type === 'ul') last.items.push(item[1]);
      else blocks.push({ type: 'ul', items: [item[1]] });
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}

/** 固定ページの本文（文節で折り返す） */
export function SimpleText({ text }: { text: string }): ReactNode {
  return (
    <div className="space-y-4 text-[15px] leading-relaxed text-ink/85">
      {parseSimpleText(text).map((block, i) => {
        switch (block.type) {
          case 'h2':
            return (
              <h2 key={i} className="jp-wrap pt-4 font-heading text-xl font-bold text-ocean first:pt-0">
                <Phrase>{block.text}</Phrase>
              </h2>
            );
          case 'h3':
            return (
              <h3 key={i} className="jp-wrap pt-2 font-bold text-ink">
                <Phrase>{block.text}</Phrase>
              </h3>
            );
          case 'ul':
            return (
              <ul key={i} className="jp-wrap list-disc space-y-1 pl-6">
                {block.items.map((item, j) => (
                  <li key={j}>
                    <Phrase>{item}</Phrase>
                  </li>
                ))}
              </ul>
            );
          default:
            return (
              <p key={i} className="jp-wrap">
                <Phrase>{block.text}</Phrase>
              </p>
            );
        }
      })}
    </div>
  );
}
