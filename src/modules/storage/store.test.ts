import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blobFileStore, localFileStore, newFileKey } from './store';

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

const blob = vi.hoisted(() => ({ objects: new Map<string, Uint8Array>(), calls: [] as unknown[] }));
vi.mock('@vercel/blob', () => ({
  put: vi.fn(async (key: string, body: Buffer, options: unknown) => {
    blob.calls.push(['put', key, options]);
    if (blob.objects.has(key)) throw new Error('already exists');
    blob.objects.set(key, new Uint8Array(body));
  }),
  get: vi.fn(async (key: string, options: unknown) => {
    blob.calls.push(['get', key, options]);
    const bytes = blob.objects.get(key);
    return bytes ? { statusCode: 200, stream: new Response(Buffer.from(bytes)).body } : null;
  }),
  del: vi.fn(async (key: string, options: unknown) => {
    blob.calls.push(['del', key, options]);
    blob.objects.delete(key);
  }),
}));

describe('blobFileStore', () => {
  beforeEach(() => {
    blob.objects.clear();
    blob.calls.length = 0;
  });

  it('非公開で保存し、鍵を付けて取り出す。上書きしない。ないキーは null', async () => {
    const store = blobFileStore('blob-token');
    const key = newFileKey('documents');
    await store.put(key, new Uint8Array([1, 2, 3]));
    expect(await store.get(key)).toEqual(new Uint8Array([1, 2, 3]));
    expect(blob.calls[0]).toEqual([
      'put',
      key,
      expect.objectContaining({
        access: 'private',
        token: 'blob-token',
        addRandomSuffix: false,
        allowOverwrite: false,
      }),
    ]);
    expect(blob.calls[1]).toEqual(['get', key, { access: 'private', token: 'blob-token' }]);
    await expect(store.put(key, new Uint8Array([9]))).rejects.toThrow();
    await store.remove(key);
    expect(await store.get(key)).toBeNull();
  });

  it('こちらで作った形以外のキーは使えない', async () => {
    const store = blobFileStore('blob-token');
    await expect(store.get('../x')).rejects.toThrow('invalid storage key');
    await expect(store.put('documents/../../x', new Uint8Array([1]))).rejects.toThrow('invalid storage key');
    expect(blob.calls).toEqual([]);
  });
});
