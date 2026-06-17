export type SweepStatus = 'complete' | 'partial' | 'failed';

export interface SweepDerived {
  voiceSamples: string[];        // max 3, each ≤ 280 chars
  faqCandidates: string[];       // max 8, each ≤ 200 chars
  inferredFacts: string[];       // max 6, each ≤ 120 chars
  extraChannels: string[];       // max 5
  extraTools: string[];          // max 5
  recurringContactCount: number;
  oldestMessageDate: string;     // ISO date
  messagesRead: number;
}

export function emptySweepDerived(): SweepDerived {
  return {
    voiceSamples: [],
    faqCandidates: [],
    inferredFacts: [],
    extraChannels: [],
    extraTools: [],
    recurringContactCount: 0,
    oldestMessageDate: new Date().toISOString().slice(0, 10),
    messagesRead: 0,
  };
}
