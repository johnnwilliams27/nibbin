/**
 * The A2A agent collector: discover the card, read the declaration, check the
 * endpoint.
 *
 * Same four-step shape as the MCP collector, one step short: there is no
 * registry module here because the A2A subjects arrive from the chain index,
 * and no rubric yet because a transcript nobody has swept is not enough to
 * write one against.
 *
 *   probe  -> what happened         (probe.ts, transcript.ts)
 *   assess -> what it means         (not yet written)
 *
 * The transcript is deliberately separable from both, so the first sweep's
 * results can be re-judged when the rubric lands without re-probing 28,459
 * agents.
 */
export {
  probeA2aAgent,
  cardCandidates,
  parseAgentCard,
  readSkills,
  readInterfaces,
  looksLikeAgentCard,
  classifyCardResponse,
  classifyRpcResponse,
  livenessMethods,
  isoNow,
  A2A_PROBE_ID,
  CARD_PATHS,
  METHOD_NOT_FOUND,
} from "./probe.js";
export type { A2aProbeOptions } from "./probe.js";
export { isSubjectFact } from "./transcript.js";
export { runA2aBattery, invokable, responseText } from "./battery.js";
export type { A2aArm, A2aCall, A2aSkillOutcome, A2aBatteryResult } from "./battery.js";
export { a2aToSubject, endpointHost, A2A_RUBRIC_VERSION } from "./subject.js";
export type { A2aProbeIdentity, BuildA2aSubjectOptions } from "./subject.js";
export type {
  A2aTranscript,
  A2aRegistryFacts,
  AssessmentGap,
  CardAttempt,
  CardDeclaration,
  CardDiscovery,
  EndpointReachability,
  InterfaceDeclaration,
  MeasurementOutcome,
  ReachabilityVerdict,
  SkillDeclaration,
} from "./transcript.js";
