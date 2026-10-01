import { describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, checkFile } from './files';
import { attachmentHeader, readUpload } from './upload';

describe('readUpload', () => {
  it('未選択・空は null。上限を超えるものは読まずに「大きすぎる」になる', async () => {
    expect(await readUpload(null)).toBeNull();
    expect(await readUpload('text')).toBeNull();
    expect(await readUpload(new File([], 'empty.pdf'))).toBeNull();
    const pdf = await readUpload(new File([new TextEncoder().encode('%PDF-1.7 test')], '保険.pdf'));
    expect(pdf?.name).toBe('保険.pdf');
    expect(checkFile(pdf!.bytes)).toMatchObject({ ok: true, mimeType: 'application/pdf' });
    const big = await readUpload(new File([new Uint8Array(MAX_FILE_BYTES + 10)], 'big.pdf'));
    expect(checkFile(big!.bytes)).toEqual({ ok: false, error: 'TOO_LARGE' });
  });

  it('ダウンロードのファイル名は ASCII の代わりと UTF-8 の両方を付ける', () => {
    expect(attachmentHeader('保険証券 "2026".pdf')).toBe(
      `attachment; filename="____ _2026_.pdf"; filename*=UTF-8''${encodeURIComponent('保険証券 "2026".pdf')}`,
    );
  });
});
