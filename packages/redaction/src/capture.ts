/**
 * Layer 1 — structural secure-field suppression (C4), applied AT CAPTURE.
 *
 * `snapshotToRawEvents` is the only constructor of RawCaptureEvent from AX
 * data. A node flagged secure by the OS (AXSecureTextField / UIA IsPassword)
 * yields an observation with NO value, NO label, and a forced-null frame —
 * the content never exists in process memory beyond the OS handoff. This is
 * a structural guarantee, never image detection.
 */
import type { AxSnapshot, AxSnapshotNode, RawAxObservation, RawCaptureEvent } from './types.js';

let counter = 0;
function eventId(): string {
  counter += 1;
  return `evt_${Date.now().toString(36)}_${counter.toString(36)}`;
}

interface FlatNode {
  node: AxSnapshotNode;
  rolePath: string;
}

function flatten(node: AxSnapshotNode, prefix: string, out: FlatNode[]): FlatNode[] {
  const rolePath = prefix === '' ? node.role : `${prefix}/${node.role}`;
  out.push({ node, rolePath });
  for (const child of node.children ?? []) flatten(child, rolePath, out);
  return out;
}

export function toObservation(node: AxSnapshotNode, rolePath: string): RawAxObservation {
  if (node.secure === true) {
    return {
      secureSuppressed: true,
      rolePath: `${rolePath}[secure]`,
      action: node.action ?? 'read',
    };
  }
  return {
    secureSuppressed: false,
    rolePath,
    action: node.action ?? 'read',
    label: node.label ?? '',
    value: node.value ?? null,
  };
}

/**
 * Normalize an AX snapshot into raw capture events — one `ax_delta` per
 * interactive node observation, with C4 suppression already applied.
 */
export function snapshotToRawEvents(
  snapshot: AxSnapshot,
  session: string,
  now: () => string = () => new Date().toISOString(),
): RawCaptureEvent[] {
  const flat = flatten(snapshot.axTree, '', []);
  const interactive = flat.filter(({ node }) => node.role !== 'window' && node.role !== 'group');

  return interactive.map(({ node, rolePath }) => {
    const obs = toObservation(node, rolePath);
    return {
      id: eventId(),
      ts: now(),
      session,
      kind: 'ax_delta' as const,
      app: { bundleId: snapshot.window.bundleId ?? snapshot.window.app, name: snapshot.window.app },
      window: {
        title: snapshot.window.title,
        id: snapshot.window.id ?? 'w_unknown',
        ...(snapshot.window.category !== undefined ? { category: snapshot.window.category } : {}),
      },
      ...(snapshot.url !== undefined ? { url: snapshot.url } : {}),
      ax: obs,
      // C4: secure observations can never carry a frame.
      frameRef: obs.secureSuppressed ? null : (snapshot.frameRef ?? null),
    };
  });
}
