import { describe, it, expect } from 'vitest';
import { sentryBeforeSend } from '../src/sentry-scrub';

describe('sentryBeforeSend scrubber (RISKS §3)', () => {
  it('strips sensitive query params from request URL', () => {
    const event = {
      request: { url: 'https://nibbin.com/auth/callback?code=supersecret&state=abc&other=keep' },
    };
    const result = sentryBeforeSend(event);
    expect(result.request?.url).toContain('other=keep');
    expect(result.request?.url).not.toContain('supersecret');
    expect(result.request?.url).toContain('code=%5BFiltered%5D');
    expect(result.request?.url).toContain('state=%5BFiltered%5D');
  });

  it('strips access_token and refresh_token from URL', () => {
    const event = {
      request: { url: 'https://nibbin.com/desktop-auth?access_token=tok1&refresh_token=rt2' },
    };
    const result = sentryBeforeSend(event);
    expect(result.request?.url).not.toContain('tok1');
    expect(result.request?.url).not.toContain('rt2');
  });

  it('drops Authorization and Cookie headers', () => {
    const event = {
      request: {
        url: 'https://nibbin.com/api/foo',
        headers: {
          Authorization: 'Bearer secret-token',
          Cookie: 'session=xyz',
          'content-type': 'application/json',
        },
      },
    };
    const result = sentryBeforeSend(event);
    expect(result.request?.headers?.Authorization).toBeUndefined();
    expect(result.request?.headers?.Cookie).toBeUndefined();
    expect(result.request?.headers?.['content-type']).toBe('application/json');
  });

  it('redacts Bearer tokens from exception messages', () => {
    const event = {
      exception: {
        values: [{ value: 'Error fetching with Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def' }],
      },
    };
    const result = sentryBeforeSend(event);
    expect(result.exception?.values?.[0]?.value).not.toContain('Bearer eyJ');
    expect(result.exception?.values?.[0]?.value).toContain('[Filtered]');
  });

  it('redacts long hex strings from exception messages', () => {
    const event = {
      exception: {
        values: [{ value: 'token: abcdef1234567890abcdef1234567890ab' }],
      },
    };
    const result = sentryBeforeSend(event);
    expect(result.exception?.values?.[0]?.value).not.toContain('abcdef1234567890');
    expect(result.exception?.values?.[0]?.value).toContain('[Filtered]');
  });

  it('scrubs query_string when it is a string', () => {
    const event = {
      request: { query_string: 'code=mycode&token=mytoken&safe=yes' },
    };
    const result = sentryBeforeSend(event);
    expect(typeof result.request?.query_string).toBe('string');
    expect(result.request?.query_string as string).not.toContain('mycode');
    expect(result.request?.query_string as string).not.toContain('mytoken');
    expect(result.request?.query_string as string).toContain('safe=yes');
  });

  it('scrubs query_string when it is an object', () => {
    const event = {
      request: { query_string: { code: 'mycode', state: 'mystate', other: 'keep' } },
    };
    const result = sentryBeforeSend(event);
    const qs = result.request?.query_string as Record<string, string>;
    expect(qs.code).toBe('[Filtered]');
    expect(qs.state).toBe('[Filtered]');
    expect(qs.other).toBe('keep');
  });

  it('passes through events with no sensitive data unchanged', () => {
    const event = {
      request: { url: 'https://nibbin.com/app/grove', headers: { 'x-custom': 'val' } },
      exception: { values: [{ value: 'Something went wrong' }] },
    };
    const result = sentryBeforeSend(event);
    expect(result.request?.url).toBe('https://nibbin.com/app/grove');
    expect(result.exception?.values?.[0]?.value).toBe('Something went wrong');
  });
});
