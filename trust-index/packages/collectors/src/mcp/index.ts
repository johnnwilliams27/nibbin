/**
 * The MCP server collector: registry listing, endpoint probe, rubric, Subject.
 *
 * This is the first collector for a subject that is not on a chain, and it is
 * the shape every later one follows:
 *
 *   list  -> what exists           (registry.ts)
 *   probe -> what happened         (probe.ts, transcript.ts)
 *   assess-> what it means         (assess.ts)
 *   build -> what the engine reads (subject.ts)
 *
 * Each step is separable. A stored transcript can be re-assessed under a new
 * rubric without touching anyone's server, and the engine that scores the
 * result is the same one that scores an on-chain agent.
 */
export { listServers, parseEntry, DEFAULT_REGISTRY_BASE } from "./registry.js";
export type { RegistryEntry, ListResult, ListOptions } from "./registry.js";
export { probeMcpServer, parseRpcBody, readTools, isoNow, PROBE_ID } from "./probe.js";
export type { ProbeOptions } from "./probe.js";
export {
  assessTranscript,
  isMutatingName,
  isCredentialParam,
  maintenanceValue,
  ratio,
  MCP_RUBRIC_VERSION,
  THRESHOLDS,
} from "./assess.js";
export { transcriptToSubject, transcriptsToSubject, repositoryOwner } from "./subject.js";
export { classifyTool, classifyTools, requiredCapabilities, testability } from "./shape.js";
export type { ToolShape, TargetBinding, ToolClassification } from "./shape.js";
export type { BuildSubjectOptions, ProbeIdentity } from "./subject.js";
export type {
  ProbeTranscript,
  ProbeAttempt,
  HandshakeResult,
  ToolsResult,
  ToolDeclaration,
  RegistryFacts,
} from "./transcript.js";
