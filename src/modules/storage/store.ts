import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { del, get, put } from '@vercel/blob';

/**
 * アップロードしたファイルの保存先。キー（保存場所の名前）はこちらで作り、利用者の入力（ファイル名）は使わない。
 * 公開ディレクトリには置かず、権限を確かめるルートからだけ取り出す
 */
export interface FileStore {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  remove(key: string): Promise<void>;
}

const KEY = /^[a-z0-9-]+\/[0-9a-f-]{36}$/;

function checkKey(key: string): string {
  if (!KEY.test(key)) throw new Error(`invalid storage key: ${key}`);
  return key;
}

/** 新しい保存キー（例：documents/2f1c…）。prefix は英小文字・数字・ハイフンだけ */
export function newFileKey(prefix: string): string {
  if (!/^[a-z0-9-]+$/.test(prefix)) throw new Error(`invalid storage prefix: ${prefix}`);
  return `${prefix}/${randomUUID()}`;
}

/** ローカルのディレクトリに保存する（開発・初期運用。サーバーを作り直すと消える環境では使わない） */
export function localFileStore(root: string): FileStore {
  const resolve = (key: string) => path.join(root, checkKey(key));
  return {
    async put(key, bytes) {
      const file = resolve(key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, bytes, { flag: 'wx' });
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(resolve(key)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    async remove(key) {
      await rm(resolve(key), { force: true });
    },
  };
}

/**
 * Vercel Blob の非公開の保存先に保存する（本番）。取り出しは鍵（token）を持つサーバーからだけで、URL を知っていても開けない。
 * 同じキーには上書きしない（キーに乱数の接尾辞を付けない。キーはこちらで作るので重ならない）
 */
export function blobFileStore(token: string): FileStore {
  return {
    async put(key, bytes) {
      await put(checkKey(key), Buffer.from(bytes), {
        access: 'private',
        token,
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: 'application/octet-stream',
      });
    },
    async get(key) {
      const result = await get(checkKey(key), { access: 'private', token });
      if (!result || result.statusCode !== 200) return null;
      return new Uint8Array(await new Response(result.stream).arrayBuffer());
    },
    async remove(key) {
      await del(checkKey(key), { token });
    },
  };
}

let store: FileStore | undefined;

/**
 * 環境の保存先。BLOB_READ_WRITE_TOKEN があれば Vercel Blob（本番）、なければ STORAGE_DIR（既定は .storage/）のディスク。
 * Vercel の上ではディスクが残らないので、鍵がなければ保存しない（あとで消えるファイルを作らない）
 */
export function getFileStore(): FileStore {
  if (store) return store;
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (token) store = blobFileStore(token);
  else if (process.env.VERCEL)
    throw new Error('BLOB_READ_WRITE_TOKEN is not set (Vercel のディスクには保存できません)');
  else store = localFileStore(path.resolve(process.env.STORAGE_DIR || '.storage'));
  return store;
}
