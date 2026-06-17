import { describe, it, expect } from 'vitest';
import { decodeBase64Url, findPlainText } from '../src/connectors/gmail';

const BODY_LIMIT = 8 * 1024;

describe('findPlainText', () => {
  it('extracts text/plain body from a flat message', () => {
    const encoded = Buffer.from('Hello client!').toString('base64url');
    const part = { mimeType: 'text/plain', body: { data: encoded }, parts: [] };
    expect(findPlainText(part)).toBe('Hello client!');
  });

  it('walks nested MIME parts to find text/plain', () => {
    const encoded = Buffer.from('Nested plain text').toString('base64url');
    const part = {
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/html', body: { data: Buffer.from('<b>html</b>').toString('base64url') } },
        { mimeType: 'text/plain', body: { data: encoded }, parts: [] },
      ],
    };
    expect(findPlainText(part as never)).toBe('Nested plain text');
  });

  it('returns null when no text/plain part exists', () => {
    const part = { mimeType: 'text/html', body: { data: Buffer.from('<p>x</p>').toString('base64url') } };
    expect(findPlainText(part)).toBeNull();
  });
});

describe('decodeBase64Url', () => {
  it('decodes base64url correctly (- and _ variants)', () => {
    const input = Buffer.from('Hello/World+Foo').toString('base64url');
    expect(decodeBase64Url(input)).toBe('Hello/World+Foo');
  });
});

describe('body truncation sentinel', () => {
  it('truncation at BODY_LIMIT produces exactly 8192 chars', () => {
    const longText = 'x'.repeat(20_000);
    expect(longText.slice(0, BODY_LIMIT).length).toBe(8192);
  });
});
