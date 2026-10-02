import { MAX_FILE_BYTES } from '@/modules/storage/files';

/** 登録申請の添付の合計の上限（1 回の送信で送るので、1 ファイルの上限と同じ。Vercel の関数は送信の本文が 4.5MB まで） */
export const MAX_TOTAL_UPLOAD = MAX_FILE_BYTES;

/** 1 つの欄に添付できるファイルの数 */
export const MAX_FILES_PER_FIELD = 5;
