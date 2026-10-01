import { describe, expect, it } from 'vitest';
import { parseSimpleText } from './simple-text';

describe('parseSimpleText', () => {
  it('見出し・段落・箇条書きに分ける', () => {
    expect(parseSimpleText('はじめに\n2行目\n\n## 目的\n- 受付\n・連絡\n\n### 補足\n本文')).toEqual([
      { type: 'p', text: 'はじめに\n2行目' },
      { type: 'h2', text: '目的' },
      { type: 'ul', items: ['受付', '連絡'] },
      { type: 'h3', text: '補足' },
      { type: 'p', text: '本文' },
    ]);
  });

  it('HTML は文字として扱う（タグとして解釈しない）', () => {
    expect(parseSimpleText('<script>alert(1)</script>')).toEqual([{ type: 'p', text: '<script>alert(1)</script>' }]);
  });
});
