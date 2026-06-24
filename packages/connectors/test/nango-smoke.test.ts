import { describe, it, expect } from 'vitest';

const skip = !process.env.NANGO_SECRET_KEY;

describe.skipIf(skip)('Nango SDK smoke', () => {
  it('instantiates without throwing', async () => {
    const { Nango } = await import('@nangohq/node');
    // Note: v0.70.8 prefers `apiKey`; `secretKey` is a deprecated alias that still works.
    const nango = new Nango({ secretKey: process.env.NANGO_SECRET_KEY! });
    expect(nango).toBeTruthy();
  });
});
