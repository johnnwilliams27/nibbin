import { describe, it, expect } from 'vitest';
import { classifyIntent } from '@nibbin/channels';

describe('classifyIntent', () => {
  it('a button press with requestId + action is an approval', () => {
    expect(classifyIntent({ channel: 'telegram', externalId: '9', text: 'r1:approve', inReplyTo: 'r1', action: 'approve', receivedAt: 1 }))
      .toEqual({ kind: 'approval', requestId: 'r1', decision: 'approve' });
  });
  it('a question is a status intent', () => {
    expect(classifyIntent({ channel: 'telegram', externalId: '9', text: 'what is my grove doing?', receivedAt: 1 }).kind).toBe('status');
  });
  it('an imperative is a work intent', () => {
    expect(classifyIntent({ channel: 'telegram', externalId: '9', text: 'draft this month invoice follow-ups', receivedAt: 1 }).kind).toBe('work');
  });
});
