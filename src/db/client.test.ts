import { describe, expect, it } from 'vitest';
import { withVerifiedSsl } from './client';

describe('withVerifiedSsl', () => {
  it('require などは verify-full にする（ほかの値・パラメータはそのまま）', () => {
    expect(withVerifiedSsl('postgres://u:p@ep-x-pooler.neon.tech/db?sslmode=require&channel_binding=require')).toBe(
      'postgres://u:p@ep-x-pooler.neon.tech/db?sslmode=verify-full&channel_binding=require',
    );
    expect(withVerifiedSsl('postgres://u:p@h/db?sslmode=verify-full')).toBe('postgres://u:p@h/db?sslmode=verify-full');
  });

  it('SSL の指定がない（手元の DB）・URL の形でないものはそのまま', () => {
    expect(withVerifiedSsl('postgres://postgres:postgres@localhost:5433/marine_dev')).toBe(
      'postgres://postgres:postgres@localhost:5433/marine_dev',
    );
    expect(withVerifiedSsl('host=localhost dbname=x')).toBe('host=localhost dbname=x');
  });
});
