/**
 * Field-study cloud sync (design 2026-06-15) + review-before-upload gate
 * (Trust & Controls spec §5.2). Build the diagnosis packet on-device, show it
 * to the user, and upload only what they approve — advancing the study ONLY on
 * a 200 so the daemon never deletes raw data before the packet is safely
 * off-device (C3/C7).
 */
import { segmentStudy } from '@nibbin/redaction';

export type SyncState = 'building' | 'reviewing' | 'uploading' | 'done' | 'error';

/** The on-device diagnosis packet `segmentStudy` produces (the cloud contract). */
export type DiagnosisPacket = Awaited<ReturnType<typeof segmentStudy>>;

/** The user's choice at the review-before-upload gate (T3/T4). */
export type ReviewDecision =
  | { action: 'send'; packet: DiagnosisPacket }
  | { action: 'delete' }
  | { action: 'cancel' };

const WEB_ORIGIN = 'https://nibbin.com';

interface SyncBridge {
  reviewEvents(): Promise<unknown[]>;
  accessToken(): Promise<string | null>;
  sendControl(cmd: string): Promise<void>;
}

/** Drop the workflows the user removed at the review gate, by key. */
export function filterPacket(packet: DiagnosisPacket, removedKeys: Set<string>): DiagnosisPacket {
  return { ...packet, workflows: packet.workflows.filter((w) => !removedKeys.has(w.key)) };
}

export async function syncStudy(opts: {
  studyId: string;
  bridge: SyncBridge;
  now: string;
  kind?: 'full_study' | 'quick_scan';
  depth?: 'lite' | 'detailed';
  label?: string | null;
  fetchFn?: typeof fetch;
  onState?: (s: SyncState) => void;
  /** Review-before-upload gate (§5.2): the only egress artifact is shown before
   * it leaves the device. Omitted = legacy direct upload (back-compat). */
  review?: (packet: DiagnosisPacket) => Promise<ReviewDecision>;
}): Promise<{ ok: boolean; error?: string; deleted?: boolean }> {
  const { studyId, bridge, now, kind, depth, label, fetchFn = fetch, onState = () => {}, review } = opts;
  try {
    onState('building');
    const events = (await bridge.reviewEvents()) as Parameters<typeof segmentStudy>[1];
    const packet = await segmentStudy(studyId, events, now, { kind, depth, label });

    let toUpload: DiagnosisPacket = packet;
    if (review) {
      onState('reviewing');
      const decision = await review(packet);
      if (decision.action === 'cancel') {
        // Nothing leaves the device; the study waits for the user to come back.
        return { ok: false, error: 'review_cancelled' };
      }
      if (decision.action === 'delete') {
        // "Delete instead": wipe locally, upload nothing (TC-P4).
        await bridge.sendControl('delete_everything');
        return { ok: true, deleted: true };
      }
      toUpload = decision.packet;
    }

    const token = await bridge.accessToken();
    if (!token) { onState('error'); return { ok: false, error: 'not_signed_in' }; }

    onState('uploading');
    const res = await fetchFn(`${WEB_ORIGIN}/api/study/packet`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(toUpload),
    });
    if (!res.ok) { onState('error'); return { ok: false, error: `upload_${res.status}` }; }

    // 200 confirmed → safe to let the daemon delete raw data.
    await bridge.sendControl('synthesis_complete');
    onState('done');
    return { ok: true };
  } catch (e) {
    onState('error');
    return { ok: false, error: e instanceof Error ? e.message : 'sync_failed' };
  }
}
