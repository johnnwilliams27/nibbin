import { readFileSync } from "node:fs";
import { score } from "../src/index.js";
import type { AgentSnapshot } from "@trust-index/types";

const snapshot = JSON.parse(readFileSync(new URL("../../../fixtures/snapshots/thin-same-day-cohort.json", import.meta.url), "utf8")) as AgentSnapshot;
const { result } = score(snapshot);
console.log(JSON.stringify(result.reviewer_weights, null, 2));
console.log("global n_eff", result.n_eff);
console.log(JSON.stringify(result.scores_by_context, null, 2));
