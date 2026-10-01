import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

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

/** 新しい保存キー（例：documents/2f1c…）。prefix は英小文字・数字・ハイフンだけ */
export function newFileKey(prefix: string): string {
  if (!/^[a-z0-9-]+$/.test(prefix)) throw new Error(`invalid storage prefix: ${prefix}`);
  return `${prefix}/${randomUUID()}`;
}

/** ローカルのディレクトリに保存する（開発・初期運用。サーバーを作り直すと消える環境では使わない） */
export function localFileStore(root: string): FileStore {
  const resolve = (key: string) => {
    if (!KEY.test(key)) throw new Error(`invalid storage key: ${key}`);
    return path.join(root, key);
  };
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

let store: FileStore | undefined;

/** 環境の保存先（STORAGE_DIR、既定は .storage/）。本番の保存先（S3 互換など）が決まったらここで切り替える */
export function getFileStore(): FileStore {
  store ??= localFileStore(path.resolve(process.env.STORAGE_DIR || '.storage'));
  return store;
}
