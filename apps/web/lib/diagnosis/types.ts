/**
 * Diagnosis pipeline types (SPEC §4.5, §5, §8 M7).
 *
 * The Observer (desktop) produces a redacted, structured **synthesis packet** —
 * pixels never leave the device (C7), only this. The cloud ingests it and
 * synthesizes the **diagnosis**: a workflow map (where the hours go), bespoke
 * Nibbin recommendations, and (PR 2) the Grovekeeper's letter. SPEC §6.11: the
 * packet *becomes* the diagnosis and is deleted with it, so both live on one row.
 *
 * This is the cloud-side contract the desktop Observer will match when it ships.
 */

export type WorkflowCategory =
  | 'email'
  | 'calendar'
  | 'payments'
  | 'crm'
  | 'docs'
  | 'social'
  | 'other';

/** One workflow the Observer segmented on-device (already redacted). */
export interface PacketWorkflow {
  /** Stable id, e.g. 'email.inquiries' — may match a §4.4 scan-module key. */
  key: string;
  /** Redacted human label, e.g. 'Answering client inquiries'. */
  label: string;
  category: WorkflowCategory;
  /** App names observed, e.g. ['Gmail', 'HoneyBook']. */
  apps: string[];
  /** Total minutes observed across the study window. */
  minutesObserved: number;
  /** Discrete sessions/instances observed. */
  sessions: number;
  /** Redacted friction note, if any. */
  friction?: string;
}

/** The redacted, structured artifact uploaded from the device (C7). */
export interface SynthesisPacket {
  version: 1;
  /** Study window length in days (1–14). */
  studyDays: number;
  capturedFrom: string; // ISO
  capturedTo: string; // ISO
  workflows: PacketWorkflow[];
}

export type Frequency = 'daily' | 'weekly' | 'occasional';

/** A synthesized workflow in the diagnosis map. */
export interface DiagnosisWorkflow {
  key: string;
  label: string;
  category: WorkflowCategory;
  hoursPerWeek: number;
  frequency: Frequency;
  friction: string | null;
  /** Shop template key the user can adopt to take this on, or null. */
  recommendedNibbin: string | null;
  /** One-line human description from the Opus labeling pass (optional). */
  description?: string;
}

/** The synthesized diagnosis map — the data behind the Day-14 reveal. */
export interface DiagnosisMap {
  workflows: DiagnosisWorkflow[];
  totalHoursPerWeek: number;
  /** Top recommended shop-template keys, ranked by hours, deduped. */
  topRecommendations: string[];
}
