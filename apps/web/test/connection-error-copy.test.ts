import { expect, it, describe } from 'vitest';
import { connectionErrorMessage } from '../app/app/connections/connection-error';

describe('connectionErrorMessage', () => {
  it('declined → retry', () => {
    expect(connectionErrorMessage('declined').action).toBe('retry');
    expect(connectionErrorMessage('declined').title).toMatch(/didn.t finish/i);
  });
  it('expired → restart', () => {
    expect(connectionErrorMessage('expired').action).toBe('restart');
  });
  it('invalid_state → restart', () => {
    expect(connectionErrorMessage('invalid_state').action).toBe('restart');
  });
  it('exchange_failed → retry', () => {
    expect(connectionErrorMessage('exchange_failed').action).toBe('retry');
  });
  it('save_failed → retry, generic body, no raw error', () => {
    const m = connectionErrorMessage('save_failed');
    expect(m.action).toBe('retry');
    expect(m.body).not.toMatch(/stack|token|undefined/i);
  });
  it('unavailable → none', () => {
    expect(connectionErrorMessage('unavailable').action).toBe('none');
  });
  it('unknown code → safe generic', () => {
    expect(connectionErrorMessage('xyz').action).toBe('none');
  });
});
