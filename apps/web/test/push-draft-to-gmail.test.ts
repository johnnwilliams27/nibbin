import { expect, it } from 'vitest';
import { pushDraftToGmail } from '../lib/connections/push-draft';

const baseInput = { nibbinId: 'nib1', runId: 'run1', draftStepIdx: 0, accountId: 'acc1' };

function makeDeps(overrides: Partial<Parameters<typeof pushDraftToGmail>[1]> = {}) {
  return {
    loadDraftPayload: async () => 'cmFiYzEyMw==',  // base64url 'rabc123'
    hasGrant: async () => true,
    gmailConnectionId: async () => 'conn1',
    createDraft: async () => ({ id: 'draft-xyz' }),
    ...overrides,
  };
}

it('happy path: returns gmailDraftId from createDraft', async () => {
  const result = await pushDraftToGmail(baseInput, makeDeps());
  expect(result.gmailDraftId).toBe('draft-xyz');
});

it('throws when no gmail connection exists for the account', async () => {
  await expect(
    pushDraftToGmail(baseInput, makeDeps({ gmailConnectionId: async () => null })),
  ).rejects.toThrow(/no active gmail connection/i);
});

it('throws when email.send grant is missing', async () => {
  await expect(
    pushDraftToGmail(baseInput, makeDeps({ hasGrant: async () => false })),
  ).rejects.toThrow(/email\.send grant/i);
});

it('throws when draft step has no rfc822 payload', async () => {
  await expect(
    pushDraftToGmail(
      baseInput,
      makeDeps({ loadDraftPayload: async () => { throw new Error('step not found'); } }),
    ),
  ).rejects.toThrow(/step not found/i);
});
