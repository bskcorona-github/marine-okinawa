import { describe, expect, it } from 'vitest';
import { isOwnKey, ownValue } from './own';

describe('ownValue / isOwnKey', () => {
  const labels = { guide: '初めての方へ' };
  it('自分のキーだけを見る', () => {
    expect(ownValue(labels, 'guide')).toBe('初めての方へ');
    expect(ownValue(labels, 'toString')).toBeUndefined();
    expect(ownValue(labels, '__proto__')).toBeUndefined();
    expect(ownValue(labels, 1)).toBeUndefined();
    expect(isOwnKey(labels, 'guide')).toBe(true);
    expect(isOwnKey(labels, 'constructor')).toBe(false);
  });
});
