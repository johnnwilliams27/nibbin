# SPIKE: ERC-8183 hire/activate flow on BNB Smart Chain

**Timebox:** 90 min, 2026-09-09. Submission due 12:00 UTC.
**Question:** can we (a) deploy an agent to BSC and (b) demo a working "hire/activate" flow via ERC-8183?

**STATUS: IN PROGRESS — findings appended live.**

---

## 1. Toolkit is real and works

`@bnbagent/studio-cli@0.0.13` (bin: `bag`) installs clean, no auth needed to install.

```bash
mkdir -p spike-8183 && cd spike-8183
npm init -y
npm install @bnbagent/studio-cli@0.0.13
./node_modules/.bin/bag --help
```

262 packages, ~30s, 0 vulnerabilities. Published by BNB Chain org accounts
(`yolin@bnbchain.org`, `devin@bnbchain.org`, `aiden.c@nodereal.io`) — first-party, not a squat.
Repo: https://github.com/bnb-chain/bnbagent-studio

### Command surface (real)

| Command | Purpose |
|---|---|
| `bag init <name>` | scaffold a seller agent project |
| `bag dev` | run agent locally |
| `bag deploy --provider bnb\|aws\|azure` | deploy to a hosted runtime |
| `bag erc8004 register/show/resolve` | on-chain agent identity |
| `bag erc8183 list/buy/status/submit/fetch/settle` | **the commerce flow** |
| `bag wallet new/show/balance/session` | local EVM keystore |
| `bag platform login/credit/agents` | BNB managed platform (GitHub device login) |
| `bag doctor` | diagnose project + env |

Bundled docs are excellent — 15 reference playbooks at
`node_modules/@bnbagent/studio-cli/skills/references/`, incl.
`bnbagent-studio-buying-via-8183.md` and `-selling-via-8183.md`.

---

## 2. ERC-8183 contract addresses (extracted from the SDK, authoritative)

From `@bnbagent/sdk/networks` → `BNB_CHAIN_ADDRESSES`:

**BSC Testnet (chain 97)**
| Role | Address |
|---|---|
| commerceProxy (**the ERC-8183 contract you call**) | `0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE` |
| commerceImpl | `0x153783DdBDF5233c591965F04644b1df2d1A7815` |
| routerProxy | `0xD7d36D66d2F1B608A0F943f722D27e3744f66F25` |
| policy | `0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA` |
| paymentToken "U" | `0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565` |

**BSC Mainnet (chain 56)**
| Role | Address |
|---|---|
| commerceProxy | `0xEa4DAa3100A767e86FDed867729ae7446476EBA6` |
| routerProxy | `0x51895229E12F9876011789B04f8698af06cCD6DA` |
| paymentToken "U" | `0xcE24439F2D9C6a2289F741120FE202248B666666` |

### FUNDING GOTCHA (important)
The escrow token is **"U" / United Stables**, *not USDC*. Our ~$5 USDC does **not**
pay for jobs. On testnet we need **tBNB (gas)** + **testnet U**, both from faucets.

Mitigation found: **`--budget-u 0` is a supported first-class path** ("signed FREE quote").
A zero-budget job skips the ERC-20 approval and escrow entirely — no U balance needed at all.
The full lifecycle (create → register → set_budget → fund → submit → fetch → settle)
still runs on-chain. This makes a demo possible with only tBNB for gas.

Further: on **testnet**, ERC-8183 kernel writes are **gas-sponsored via a MegaFuel paymaster**
when they target the canonical contracts above. So even tBNB spend is near-zero.
(Mainnet is never sponsored. Custom `ERC8183_*_ADDRESS` overrides are not sponsored either.)

---

## 3. The hire flow (buyer side) — exact mechanics

`bag erc8183 buy` runs **4 sequential on-chain txs** against commerceProxy:

1. `createJob(provider, expiredAt, description)` → returns `job_id`
2. `registerJob(jobId)`
3. `setBudget(jobId, rawBudget)`
4. `fund(jobId, rawBudget, approveFloor)` — skips ERC-20 approve+escrow when budget is 0

```bash
bag erc8183 buy --provider <seller_addr> "<task>" \
  --budget-u 0 --deadline-min 30 --network bsc-testnet
```
`--provider` (or `--agent-id`) is a **required flag**, not positional. `--agent-id`
resolves the seller's endpoint from ERC-8004 and runs a `/negotiate` handshake first;
`--provider <addr> --no-negotiate` skips that and assumes an off-chain agreed price.

Job states: `OPEN → FUNDED → SUBMITTED → COMPLETED` (or `EXPIRED`).

---

## 4. ⚠️ THE 24-HOUR BLOCKER (and the way around it)

**`settle --action approve` is chain-refused until 24h after SUBMITTED.**
The dispute window is enforced on-chain; approving early reverts with `0x17be5b7b`.

> `expired_at = now + deadline_minutes*60 + dispute_window(24h)`

**We cannot reach `COMPLETED` before 12:00 UTC today. Full stop.**

Ways through:
- `settle --action dispute` works **immediately**, within the window, and is a real
  on-chain settlement tx. Demoable now.
- Everything up to and including `SUBMITTED` + `fetch <deliverable_url>` is demoable now.
  That is: post job → escrow → agent delivers → buyer retrieves deliverable. Arguably this
  IS "activating an agent end-to-end" for the Functionality criterion.
- A job bought *today* can be `approve`d tomorrow — good for a follow-up/demo video, not for
  the 12:00 deadline.

---

## 5. Deploy: what it actually requires

`bag deploy --provider bnb|aws|azure`. The BNB managed option is a **48h testnet trial**:

```bash
bag platform login    # GitHub DEVICE LOGIN — prints URL + code, needs a human
bag platform credit
bag deploy prepare --provider bnb --backend aws
bag deploy --provider bnb --yes
```

Requirements: a GitHub account + interactive device-code verification, and the deploy
transmits runtime signing material to BNB's managed secret store (docs say use a
**throwaway wallet**, never a mainnet key). AWS/Azure paths need your own cloud creds.

### ⭐ KEY UNLOCK: hosting is NOT required for the hire demo
`bag erc8183 submit <job_id> <response_text>` is a **plain seller-side CLI command**.
The seller does not have to be a deployed HTTPS service to fulfil a job — the deliverable
is written on-chain by the `submit` tx and read back via `bag erc8183 fetch`.
So the entire buy → deliver → fetch → settle loop can be driven from two local wallets
with **no hosted runtime, no GitHub login, no cloud account**.

Hosted deployment is what makes the seller *discoverable + autonomous* (A2A `notify_funded`,
background delivery). It is a polish item, not a gate on demonstrating the hire flow.

---

*(continues below as the spike proceeds)*
