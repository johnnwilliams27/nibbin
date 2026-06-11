/**
 * Layer 4 — end-of-day review. Review is a right, not a chore: unreviewed
 * days still process (review_state stays 'auto'). Users can delete blocks
 * (by event id, time range, or app) and add exclusions that feed back into
 * layer 2 for the rest of the study.
 */
import type { ObserverEvent, ReviewState } from './types.js';

export interface ReviewableStore {
  listEvents(): Promise<ObserverEvent[]>;
  setReviewState(eventIds: string[], state: ReviewState): Promise<void>;
  purgeEvents(eventIds: string[]): Promise<void>;
}

export interface BlockSelector {
  eventIds?: string[];
  timeRange?: { from: string; to: string };
  appName?: string;
}

function matches(e: ObserverEvent, sel: BlockSelector): boolean {
  if (sel.eventIds && sel.eventIds.includes(e.id)) return true;
  if (sel.timeRange && e.ts >= sel.timeRange.from && e.ts <= sel.timeRange.to) return true;
  if (sel.appName && e.app.name === sel.appName) return true;
  return false;
}

/**
 * Delete a block: matching events are marked user_deleted AND purged from the
 * store — deletion in review is real deletion, not a soft flag the exporter
 * has to remember to honor (the exporter filter is defense in depth).
 */
export async function deleteBlock(store: ReviewableStore, sel: BlockSelector): Promise<number> {
  const events = await store.listEvents();
  const hit = events.filter((e) => matches(e, sel)).map((e) => e.id);
  if (hit.length > 0) {
    await store.setReviewState(hit, 'user_deleted');
    await store.purgeEvents(hit);
  }
  return hit.length;
}

export async function keepBlock(store: ReviewableStore, sel: BlockSelector): Promise<number> {
  const events = await store.listEvents();
  const hit = events.filter((e) => matches(e, sel)).map((e) => e.id);
  if (hit.length > 0) await store.setReviewState(hit, 'user_kept');
  return hit.length;
}
