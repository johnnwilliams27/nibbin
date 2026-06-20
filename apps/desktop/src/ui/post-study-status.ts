/**
 * Fire-and-forget status signal: tells the web when a field study or quick scan
 * starts or stops. Mirrors the Bearer-auth pattern in sync-study.ts (§fetch
 * to WEB_ORIGIN). Swallows all errors — never blocks or throws into the UI.
 *
 * The web uses this to show an in-progress card and emit leaves. No capture
 * content is sent — status only.
 */
import { bridge } from "./bridge.js";

const WEB_ORIGIN = "https://nibbin.com";

export interface StudyStatusPayload {
  studyId: string;
  kind: "full_study" | "quick_scan";
  label?: string | null;
  status: "active" | "stopped";
  startedAt: string;
  endsAt?: string | null;
}

/**
 * Posts a minimal study-status signal to the web.
 * Fire-and-forget: awaiting is optional; any network or auth error is swallowed.
 */
export async function postStudyStatus(payload: StudyStatusPayload): Promise<void> {
  try {
    const token = await bridge.accessToken();
    if (!token) return; // not signed in — skip silently
    await fetch(`${WEB_ORIGIN}/api/study/status`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // Network errors are expected when offline — never surface to the UI.
  }
}
