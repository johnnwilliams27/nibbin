/**
 * The 14-day companion arc (SPEC §4.5). Types + ports.
 *
 * The scheduler is pure: it takes a clock, an arc's state, and per-user
 * delivery preferences, and decides which beat (if any) is due RIGHT NOW.
 * Everything with a side effect (store, email, notifications, M4 data)
 * lives behind a port so the whole arc is simulatable in a fast-clock test.
 */

/** Every beat in the §4.5 table that the cloud worker delivers (day 0 — the
 * hatch — IS onboarding §4.1 and is never pushed by the drip). */
export type BeatKey =
  | 'field_notes_1' // day 1 — first Field Notes, evening
  | 'species' // day 2 — meet the six species
  | 'training_1' // day 3 — first training session
  | 'journal' // day 4 — what {name} has learned about you
  | 'study_whisper' // day 5 — Field Study teaser (Observer users)
  | 'scan_depth' // day 5 substitute — deeper scan insight (no Observer)
  | 'half_time' // day 7 — Half-time Report (ceremony)
  | 'training_2' // day 9 — second training session + honest demotion
  | 'map_preview' // day 10 — sprouting workflow map (ceremony)
  | 'graduation_eve' // day 12 — only if a Nibbin is near threshold
  | 'diagnosis_reveal'; // day 14 — the Diagnosis Reveal (ceremony)

export interface BeatDef {
  key: BeatKey;
  /** Whole local-calendar days after the hatch (arc start). */
  day: number;
  /** Earliest local hour this beat may go out (Field Notes are an evening report). */
  earliestHour: number;
  kind: 'standard' | 'ceremony';
  /** Conditional beats: 'study' substitutes when no study is running;
   * 'near_graduation' is skipped outright when nothing is close. */
  requires?: 'study' | 'near_graduation';
  substitute?: BeatKey;
}

/** Quiet hours in the user's local time, [start, end) — wraps midnight. */
export interface QuietHours {
  start: number;
  end: number;
}

export type SendStatus = 'claimed' | 'sent' | 'failed' | 'skipped';

export interface SendRecord {
  beat: BeatKey;
  status: SendStatus;
  /** Local calendar day (YYYY-MM-DD in the user's tz) the push went out. */
  localDay: string;
  /** Absolute claim time — the tz-flip-proof spacing guard keys off this. */
  claimedAt: Date | null;
}

export type ArcStatus = 'active' | 'completed' | 'stopped';

export interface ArcState {
  accountId: string;
  startedAt: Date;
  /** IANA tz from users.tz — user-controlled, so treat as untrusted input. */
  tz: string | null;
  quiet: QuietHours;
  emailEnabled: boolean;
  sends: SendRecord[];
}

export interface ArcFlags {
  /** A Field Study is currently running on the user's device. */
  studyActive: boolean;
  /** Some Nibbin is within reach of graduating (drives day 12). */
  nearGraduation: boolean;
}

export interface BeatPlan {
  /** The single beat to deliver now, if any (max one push/day). */
  send: BeatKey | null;
  /** Older missed beats to retire quietly — the arc never dumps a backlog. */
  skip: BeatKey[];
  /** True once day 14 has passed and every beat is resolved. */
  arcComplete: boolean;
}

// ── beat content (shared by the notification leaf + the email mirror) ───────

export interface BeatCard {
  title: string;
  body: string;
}

/** One celebration per touch, maximum — the renderer enforces it by shape. */
export interface Celebration {
  heading: string;
  body: string;
}

export interface BeatContent {
  key: BeatKey;
  title: string;
  /** Grovekeeper voice, plain sentences. Used verbatim as the plain-text core. */
  body: string;
  cards: BeatCard[];
  celebration: Celebration | null;
  /** Path under the product origin the touch points at. */
  ctaPath: string;
  ctaLabel: string;
}

// ── M4 data port (stub while M4 is in flight; reconcile on rebase) ──────────

export interface NibbinDaySummary {
  name: string;
  runs: number;
  draftsWaiting: number;
}

export interface ScanInsight {
  /** One plain sentence, already user-safe (no raw provider content). */
  text: string;
}

export interface JournalEntry {
  nibbin: string;
  learned: string;
}

export interface WorkflowCluster {
  name: string;
  /** 0..1 — the day-10 map is honest about being a sketch. */
  confidence: number;
}

export interface NearGraduation {
  nibbin: string;
  approvedDraftsRemaining: number;
}

export interface EarnedEvent {
  id: string;
  kind: 'evolution' | 'graduation';
  nibbin: string;
  detail: string;
  // creature metadata for the in-leaf celebration (rendered at the NEW stage)
  nibbinId: string;
  species: string;
  stage: string;
  palette: string | null;
  accessory: string | null;
  marking: string | null;
}

/**
 * Everything the arc would like to know from M4 (runs, drafts, scan, School).
 * IMPORTANT (C1/C7): this port carries CLOUD data only — connector-scan
 * results and Nibbin run stats. Field Study numbers are computed on-device
 * (apps/desktop field-notes) and never flow through here; study beats in the
 * cloud are pointers to the grove, not carriers of study data.
 */
export interface ArcDataPort {
  flags(accountId: string): Promise<ArcFlags>;
  nibbinDay(accountId: string, localDay: string): Promise<NibbinDaySummary[]>;
  /** Scan insights the user has not seen yet, freshest first. */
  unseenInsights(accountId: string): Promise<ScanInsight[]>;
  journal(accountId: string): Promise<JournalEntry[]>;
  clusters(accountId: string): Promise<WorkflowCluster[]>;
  nearGraduation(accountId: string): Promise<NearGraduation | null>;
  /** Evolution/graduation events earned since the last tick — these fire
   * whenever earned, in-product only, and never count against one push/day. */
  earnedEvents(accountId: string): Promise<EarnedEvent[]>;
  /** Keeper + first-Nibbin names for copy (falls back gracefully). */
  names(accountId: string): Promise<{ keeper: string | null; firstNibbin: string | null }>;
}

// ── store + delivery ports ───────────────────────────────────────────────────

export interface ArcRow extends ArcState {
  /** The arc owner's email for the mirror (memberships → users). */
  email: string;
  /** Beats run only while 'active'; earned-event leaves deliver regardless. */
  status: ArcStatus;
}

/** A skip retires a whole slot — beat is what would have shown, slot dedups. */
export interface SkipEntry {
  beat: BeatKey;
  slot: BeatKey;
}

export interface DripStore {
  /** Every arc, any status — the worker filters; School events outlive beats. */
  arcs(): Promise<ArcRow[]>;
  /**
   * Atomically claim a slot for today's push. MUST return false if this slot
   * was ever resolved before, if any other push already claimed this local
   * day, OR if any non-skipped claim is younger than the 20h spacing floor —
   * all enforced in the store (unique indexes + insert guard), never by the
   * caller's snapshot: a stale worker must not be able to double-push.
   */
  claimSend(accountId: string, beat: BeatKey, slot: BeatKey, localDay: string): Promise<boolean>;
  markSent(accountId: string, beat: BeatKey): Promise<void>;
  markFailed(accountId: string, beat: BeatKey): Promise<void>;
  recordSkipped(accountId: string, skips: SkipEntry[], localDay: string): Promise<void>;
  completeArc(accountId: string): Promise<void>;
  /** Idempotent on event.id — earned events must not duplicate on retry. */
  insertEarnedNotification(accountId: string, event: EarnedEvent): Promise<void>;
  insertBeatNotification(accountId: string, content: BeatContent): Promise<void>;
}

export interface BeatEmail {
  accountId: string;
  to: string;
  beat: BeatKey;
  content: BeatContent;
}

export interface EmailPort {
  /** Returns false when the send was withheld (suppressed, warm-up cap…). */
  sendBeat(email: BeatEmail): Promise<boolean>;
}

export type Clock = () => Date;
