import { describe, expect, it } from 'vitest';
import { checkFile, detectFileType, MAX_FILE_BYTES, safeFileName } from './files';

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => new TextEncoder().encode(text);

describe('detectFileType', () => {
  it('PDF・JPEG・PNG・WebP を中身で判定する', () => {
    expect(detectFileType(ascii('%PDF-1.7\n...'))).toBe('application/pdf');
    expect(detectFileType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0))).toBe('image/jpeg');
    expect(detectFileType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe('image/png');
    expect(detectFileType(ascii('RIFF\u0000\u0000\u0000\u0000WEBPVP8 '))).toBe('image/webp');
  });

  it('実行ファイル・スクリプト・HTML・ZIP（Office 文書）は受け付けない', () => {
    expect(detectFileType(ascii('MZ\u0090\u0000'))).toBeNull(); // Windows の実行ファイル
    expect(detectFileType(bytes(0x7f, 0x45, 0x4c, 0x46))).toBeNull(); // ELF
    expect(detectFileType(ascii('#!/bin/sh\n'))).toBeNull();
    expect(detectFileType(ascii('<html><script>'))).toBeNull();
    expect(detectFileType(bytes(0x50, 0x4b, 0x03, 0x04))).toBeNull();
    expect(detectFileType(ascii('RIFF\u0000\u0000\u0000\u0000WAVE'))).toBeNull();
  });
});

describe('checkFile', () => {
  it('空・大きすぎるファイルを拒否する', () => {
    expect(checkFile(new Uint8Array())).toEqual({ ok: false, error: 'EMPTY' });
    const big = new Uint8Array(MAX_FILE_BYTES + 1);
    big.set(ascii('%PDF-'));
    expect(checkFile(big)).toEqual({ ok: false, error: 'TOO_LARGE' });
    expect(checkFile(ascii('%PDF-1.4'))).toEqual({ ok: true, mimeType: 'application/pdf', size: 8 });
  });
});

describe('safeFileName', () => {
  it('パスの区切り・制御文字を除き、拡張子は判定した形式にそろえる', () => {
    expect(safeFileName('../../etc/passwd.exe', 'application/pdf')).toBe('.._.._etc_passwd.pdf');
    expect(safeFileName('保険証券 2026.PDF', 'application/pdf')).toBe('保険証券 2026.pdf');
    expect(safeFileName('', 'image/png')).toBe('file.png');
  });
});
