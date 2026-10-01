import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { localFileStore, newFileKey } from './store';

describe('localFileStore', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'marine-store-'));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it('保存・取り出し・削除。ないキーは null', async () => {
    const store = localFileStore(root);
    const key = newFileKey('documents');
    await store.put(key, new Uint8Array([1, 2, 3]));
    expect(await store.get(key)).toEqual(new Uint8Array([1, 2, 3]));
    await store.remove(key);
    expect(await store.get(key)).toBeNull();
  });

  it('同じキーには上書きしない。こちらで作った形以外のキー（パスを含むもの）は使えない', async () => {
    const store = localFileStore(root);
    const key = newFileKey('documents');
    await store.put(key, new Uint8Array([1]));
    await expect(store.put(key, new Uint8Array([2]))).rejects.toThrow();
    await expect(store.get('../../etc/passwd')).rejects.toThrow('invalid storage key');
    await expect(store.get('documents/../../x')).rejects.toThrow('invalid storage key');
    expect(() => newFileKey('../x')).toThrow();
  });
});
