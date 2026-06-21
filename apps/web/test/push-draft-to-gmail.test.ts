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

// Task 4: loadNativeDraftRef guard — prevents double-create when the runner
// already mirrored the draft to Gmail at draft time (nativeDraft:true).
it('Task 4: when loadNativeDraftRef returns a stored ref, returns it directly without calling createDraft', async () => {
  const createDraftCalls: string[] = [];
  const result = await pushDraftToGmail(baseInput, makeDeps({
    createDraft: async (rfc822) => { createDraftCalls.push(rfc822); return { id: 'would-be-second-draft' }; },
    loadNativeDraftRef: async () => 'gmail-draft-already-created',
  }));
  // Should return the stored ref, NOT call createDraft
  expect(result.gmailDraftId).toBe('gmail-draft-already-created');
  expect(createDraftCalls).toHaveLength(0);
});

it('Task 4: when loadNativeDraftRef returns null, falls through to createDraft normally', async () => {
  const createDraftCalls: string[] = [];
  const result = await pushDraftToGmail(baseInput, makeDeps({
    createDraft: async (rfc822) => { createDraftCalls.push(rfc822); return { id: 'fresh-draft' }; },
    loadNativeDraftRef: async () => null,
  }));
  expect(result.gmailDraftId).toBe('fresh-draft');
  expect(createDraftCalls).toHaveLength(1); // createDraft was called
});

it('Task 4: without loadNativeDraftRef dep, falls through to createDraft (backward compat)', async () => {
  // The dep is optional — existing callers that don't provide it continue to work.
  const result = await pushDraftToGmail(baseInput, makeDeps());
  expect(result.gmailDraftId).toBe('draft-xyz');
});
