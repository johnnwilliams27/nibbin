import 'server-only';

export interface PushDraftToGmailInput {
  nibbinId: string;
  runId: string;
  draftStepIdx: number;
  accountId: string;
}

export interface PushDraftToGmailDeps {
  /** Load the run_steps row: returns payload.rfc822 (base64url encoded RFC 822) */
  loadDraftPayload: (runId: string, stepIdx: number, accountId: string) => Promise<string>;
  /** Check nibbin_write_grants for email.send */
  hasGrant: (nibbinId: string, connectionId: string) => Promise<boolean>;
  /** The gmail connection_id for this account */
  gmailConnectionId: () => Promise<string | null>;
  /** Create the Gmail draft */
  createDraft: (rfc822: string) => Promise<{ id?: string }>;
  /**
   * Task 4: read run_steps.payload.nativeDraftRef for this draft step. When the
   * runner already created a native Gmail draft at draft time (nativeDraft:true),
   * this returns the stored ref — pushDraftToGmail MUST return it directly instead
   * of calling createDraft again (which would create a second Gmail draft).
   * Absent (undefined) means no native-draft mirror was set; createDraft proceeds.
   */
  loadNativeDraftRef?: (runId: string, stepIdx: number, accountId: string) => Promise<string | null>;
}

export async function pushDraftToGmail(
  input: PushDraftToGmailInput,
  deps: PushDraftToGmailDeps,
): Promise<{ gmailDraftId: string | undefined }> {
  const connectionId = await deps.gmailConnectionId();
  if (!connectionId) {
    throw new Error('no active gmail connection for this account');
  }
  const granted = await deps.hasGrant(input.nibbinId, connectionId);
  if (!granted) {
    throw new Error(
      `email.send grant missing for nibbin ${input.nibbinId} — connect Gmail write access first`,
    );
  }

  // Task 4: if the runner already created a native Gmail draft (nativeDraft:true
  // at Draft action level), re-use the stored ref instead of creating a second
  // draft. Two pushes to Gmail for the same Nibbin draft would create duplicate
  // Gmail drafts in the user's mailbox and waste their quota.
  if (deps.loadNativeDraftRef) {
    const existingRef = await deps.loadNativeDraftRef(input.runId, input.draftStepIdx, input.accountId);
    if (existingRef) {
      return { gmailDraftId: existingRef };
    }
  }

  const rfc822 = await deps.loadDraftPayload(input.runId, input.draftStepIdx, input.accountId);
  const { id } = await deps.createDraft(rfc822);
  return { gmailDraftId: id };
}
