/**
 * Collectors: the layer that turns things in the world into Subjects.
 *
 * The rating engine is subject-agnostic and does no I/O. Everything that
 * touches a network, a registry or a chain lives here, produces evidence in
 * one shape, and hands it to the same estimator.
 *
 * Available: MCP servers with remote endpoints. On-chain agents are collected
 * by packages/indexer and adapted in
 * packages/scoring/src/rating/adapter.ts, which predates this package.
 */
export * from "./net.js";
export * from "./capability.js";
export * from "./prior.js";
export * as judge from "./judge/index.js";
// Namespaced separately rather than re-exported from judge/index.js: provider
// and panel both import JudgeError from it, and folding them back in would make
// that a cycle.
export * as judgeProvider from "./judge/provider.js";
export * as judgePanel from "./judge/panel.js";
export * as judgeMetrics from "./judge/metrics.js";
export * as judgeCorpus from "./judge/corpus.js";
export * as judgeMeta from "./judge/meta.js";
// The production judge: one model, chosen by measurement. See production.ts.
export * from "./judge/production.js";
export * as mcp from "./mcp/index.js";
// A2A agents, which the MCP collector could not see at all: 28,459 of them on
// BSC declare A2A and would have been probed with the wrong protocol. See
// a2a/probe.ts.
export * as a2a from "./a2a/index.js";
