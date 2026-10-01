import { loadDefaultJapaneseParser } from 'budoux';
import { Fragment, type ReactNode } from 'react';

const parser = loadDefaultJapaneseParser();

/** 直後で折り返さない文字（開きかっこ・コロン）。「（例：090-…）」が「（例：」で切れないように */
const NO_BREAK_AFTER = /[（「『【〔［(\[：:]$/;

/** 文節に分け、開きかっこ・コロンで終わる文節は次の文節とつなげる */
function phrases(line: string): string[] {
  const out: string[] = [];
  for (const chunk of parser.parse(line)) {
    const last = out.at(-1);
    if (last !== undefined && NO_BREAK_AFTER.test(last)) out[out.length - 1] = last + chunk;
    else out.push(chunk);
  }
  return out;
}

/**
 * 日本語を文節で折り返すため、文節の境目に <wbr> を入れる。
 * 親要素に .jp-wrap（word-break: keep-all）を付けて使う。改行（\n）は <br> にする。
 */
export function Phrase({ children }: { children: string }): ReactNode {
  return children.split('\n').map((line, li) => (
    <Fragment key={li}>
      {li > 0 && <br />}
      {phrases(line).map((chunk, i) => (
        <Fragment key={i}>
          {i > 0 && <wbr />}
          {chunk}
        </Fragment>
      ))}
    </Fragment>
  ));
}
