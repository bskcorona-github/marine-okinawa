import { describe, expect, it } from 'vitest';
import { splitPlanTitle } from './display-title';

describe('splitPlanTitle', () => {
  it('先頭の【…】と ★ 以降を分ける', () => {
    expect(
      splitPlanTitle('【宜野湾発】パラセーリング200ｍ　沖縄の空をひとりじめ！★GoPro無料レンタル＆写真プレザント'),
    ).toEqual({
      title: 'パラセーリング200ｍ 沖縄の空をひとりじめ！',
      tagline: 'GoPro無料レンタル＆写真プレザント',
      labels: ['宜野湾発'],
    });
  });

  it('「○○／」の付記も続けてラベルにする', () => {
    expect(
      splitPlanTitle('10名以上団体向け／【那覇・宜野湾・北谷発】（貸切6時間）慶良間１日チャーター　釣り・SUP'),
    ).toEqual({
      title: '（貸切6時間）慶良間１日チャーター 釣り・SUP',
      tagline: null,
      labels: ['10名以上団体向け', '那覇・宜野湾・北谷発'],
    });
  });

  it('★ が複数あれば補足をつなぐ。付記がなければそのまま', () => {
    expect(splitPlanTitle('大型船・少人数制☆ツアー★A★B')).toEqual({
      title: '大型船・少人数制☆ツアー',
      tagline: 'A ・ B',
      labels: [],
    });
    expect(splitPlanTitle('青の洞窟シュノーケル')).toEqual({
      title: '青の洞窟シュノーケル',
      tagline: null,
      labels: [],
    });
  });

  it('タイトル部分が空なら元の文字列を使う', () => {
    expect(splitPlanTitle('★特典のみ').title).toBe('★特典のみ');
  });
});
