# Reference-seller firewall evidence

On 2026-09-09 the user approved a 30-request/minute/IP Vercel rate limit for these two dedicated reference services. Each project was read first: active and draft configurations were null. The checked-in `firewall-reference.json` was then PUT to that project's `/v1/security/firewall/config` endpoint. A separate GET verified the active rule, with `valid: true` and no validation errors.

| Project | Project ID | Active config | Activated UTC |
| --- | --- | --- | --- |
| nibbin-reference-testnet | prj_0WCUzLdkZCVIsjA6uOZHXrZGpP8G | waf_Xvbfdlo6rj1U, version 1 | 2026-09-09 07:24:37.982 |
| nibbin-reference-mainnet | prj_0TFqhGumNoFbXP32ko65CMDdpWA7 | waf_4pa1oPiVzn25, version 1 | 2026-09-09 07:29:37.974 |

Both are in team `team_VkJLN5A17wWwz1HJp0q3SJw1`. No other projects, team spending settings, or plan upgrades were changed.

The rule matches all paths (`path pre /`), counts by `ip` in fixed 60-second windows, permits 30 requests, and returns HTTP 429 for excess requests. The configuration API created an active version directly; no separate activation call was needed.

Vercel counters are **per region**, not global. Multiple IPs, multiple regions, and fixed-window boundaries mean this is not an aggregate spending ceiling. HTTP burst enforcement was not load-tested during the concurrent on-chain smoke test; verification here is the published control-plane state. See [Vercel rate-limit documentation](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting) and [official counting-key example](https://vercel.com/kb/guide/firewall-terraform-configuration).

## Safe reuse

For a newly authorized dedicated project, GET `/v1/security/firewall/config?projectId=PROJECT_ID&teamId=TEAM_ID` first. Do not blindly PUT this full configuration over existing active or draft rules. If both are null, `vercel api` accepts `-X PUT --input ops/firewall-reference.json` against that same project-specific URL. GET again and inspect the active rule and its validation result. Use an authenticated CLI profile without printing tokens. Existing configurations need a preserving update, not replacement with this template.
