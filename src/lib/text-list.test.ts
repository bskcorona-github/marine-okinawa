import { describe, expect, it } from 'vitest';
import { toListItems } from './text-list';

describe('toListItems', () => {
  it('1 行に 1 項目。行頭の記号と空行を除く', () => {
    expect(toListItems('・水着\n- タオル\n\n• 日焼け止め')).toEqual(['水着', 'タオル', '日焼け止め']);
  });

  it('1 行だけで「、」区切りなら項目に分ける', () => {
    expect(toListItems('水着、タオル、着替え')).toEqual(['水着', 'タオル', '着替え']);
  });

  it('空なら空の配列', () => {
    expect(toListItems('')).toEqual([]);
    expect(toListItems(null)).toEqual([]);
  });
});
