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
  const rfc822 = await deps.loadDraftPayload(input.runId, input.draftStepIdx, input.accountId);
  const { id } = await deps.createDraft(rfc822);
  return { gmailDraftId: id };
}
