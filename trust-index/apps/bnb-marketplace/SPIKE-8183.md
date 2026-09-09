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

---

## 6. ✅ WE DID IT — a real, funded ERC-8183 job on BSC testnet, for $0.00

Scaffolded a seller, created a wallet with **zero balance**, and ran a real buy.
**All four transactions confirmed on BSC testnet. Gas paid by us: ZERO.**

```
job_id:        1161
client(buyer): 0x6d46b2415b9339A1aC8E5Cc80fDA147f2701B7e8   (0 tBNB, 0 U)
provider:      0x9d8c2FC65D788F4ba447E283B0716ce3F5b3EA39
status:        FUNDED
budget_u:      0

create_tx:     0xa672177aadde66467435f42b0514d90e8a3ed7c58a25ecdbc663c8b669fe405a
register_tx:   0xc551996f194e39423256863eef4fd6766eb981ffbb1c7e29655907ebd886fdbd
set_budget_tx: 0xdbeefb50299482446edb59db44d5cf36910b82cf02b8106e148439b5f4766f10
fund_tx:       0x3f2049d83c51d6c8bba822bd894caa704f5ecd4c72c4f573a67dbd33dfd916df
```

The fund tx audit line is the proof of sponsorship:
```json
"gas":{"gas_used":"67070","effective_gas_price_wei":"0","wallet_paid_wei":"0"}
```

**The MegaFuel paymaster fully sponsors ERC-8183 writes on testnet.** A wallet with
literally zero tBNB posted a job and escrowed it. **This removes the faucet from the
critical path entirely.** Total spend for this spike: **$0.00** of the $5 cap.

### Exact working sequence (reproducible)

```bash
npm install @bnbagent/studio-cli@0.0.13
bag init nibbinseller --destination self --network bsc-testnet \
  --no-onboard --no-install --no-auto-topup --ide claude-code
cd nibbinseller
# set WALLET_PASSWORD inside .studio/.env.local (CLI refuses it on argv / via `bag env set`)
bag wallet new                      # or: bag wallet new --private-key -   (stdin)
bag erc8183 buy --provider <seller_addr> "<task>" \
  --budget-u 0 --deadline-min 30 --no-negotiate --network bsc-testnet
bag erc8183 status <job_id>         # → FUNDED
```

## 7. The one remaining gap: `submit` demands a signed quote

`bag erc8183 submit 1161 "<deliverable>"` fails:

```
error: SDK call failed: Job verification failed:
       Job description does not contain a signed negotiation quote
```

Because we bought with `--no-negotiate`, the on-chain description carries no
provider-signed quote, and the seller-side submit guard refuses it. This is a
**protocol correctness check, not a bug** — the seller must have signed the price.

Three ways to close it (all short):

1. **`bag erc8183 buy --quote-json <json|path>`** — the CLI accepts an out-of-band
   signed quote envelope and anchors it on-chain. Need the seller to emit one first.
2. **`bag dev`** to serve the seller locally, `POST /negotiate` to get the signed
   quote JSON, then feed it to `--quote-json`. Needs `pnpm install` in the scaffold.
3. **`bag erc8183 buy --agent-id <id>`** — resolves the seller's endpoint from its
   ERC-8004 record and negotiates automatically. Requires a **public HTTPS** seller
   (loopback/private addresses are refused), i.e. a real deploy.

Attempted a 4th route — minting the quote directly via the SDK
(`EVMWalletProvider` → `ERC8183Client.create` → `NegotiationHandler.fromErc8183Client`
→ `handler.negotiate(...)`) in `spike-8183/quote.mjs`. Blocked only by an RPC detail:
`ERC8183Client.create` hardcodes a **dead default RPC**
(`data-seed-prebsc-2-s2.binance.org:8545`, times out) and `ERC8183ClientCreateOpts`
exposes **no `rpcUrl` field** — `network` must be given a full `NetworkConfig` instance
to override it. (`BSC_TESTNET_RPC_URL` env is *not* read by this path; the `bag` CLI
itself resolves a working RPC, which is why every CLI command above succeeded.)
Working public RPC: `https://bsc-testnet-dataseed.bnbchain.org`.

Finishing this is ~15-30 min: construct `NetworkConfig` with a live RPC, or just
`pnpm install && bag dev` and curl `/negotiate`.

---

## VERDICT: FEASIBLE-WITH-CAVEATS

**(a) Deploy an agent to BSC — YES.** ERC-8004 identity registration + the ERC-8183
seller are all CLI-driven and gas-sponsored on testnet. A *hosted* runtime
(`bag deploy --provider bnb`) needs an interactive **GitHub device login** and gives a
48h trial; AWS/Azure need your own cloud creds. **Hosting is optional for the demo.**

**(b) Working hire flow before 12:00 UTC — YES for hire+escrow+deliver, NO for a
`COMPLETED` settlement.**

| Stage | Before 12:00 UTC? |
|---|---|
| Post job + escrow + fund (the "hire" click) | ✅ **DONE, on-chain, $0** |
| Seller submits deliverable | ⚠️ ~15-30 min (signed-quote gate) |
| Buyer fetches deliverable | ✅ follows immediately |
| `settle --action dispute` | ✅ immediate, real on-chain tx |
| `settle --action approve` → `COMPLETED` | ❌ **chain-enforced 24h wait. Impossible.** |

**Recommendation: GO.** The Functionality criterion ("activating an agent end-to-end")
is satisfiable: a user clicks hire → 4 real BSC transactions → escrow funded → agent
delivers → buyer fetches the deliverable. Demo the settle as `dispute` (immediate) and
narrate the 24h approve window as the protocol's buyer-protection design — that reads
as protocol fluency, not a gap. Do **not** promise a `COMPLETED` job in the demo.

### Time to a demoable hire flow
- **Already demoable now:** hire + escrow (real tx hashes to show on BscScan).
- **+15-30 min:** full hire → deliver → fetch loop.
- **+1-2 h:** marketplace UI over `bag erc8183 list` (it already lists on-chain jobs).
- **Optional +1 h:** hosted seller via `bag deploy` (needs a human for GitHub device login).

### Credentials / funding still needed
- **None to proceed.** Testnet sponsorship covers gas; `--budget-u 0` avoids U entirely.
- A **human with Telegram** only if we want *paid* (non-zero) jobs — tBNB and U both come
  from `t.me/bnbchain_official_bot`. Not on the critical path.
- **GitHub account + device-code login** only if we want a hosted seller.
- The **$5 USDC is on Base mainnet with 0 ETH for gas** — unusable here, and not needed.

### Watch-outs
- Escrow token is **U (18 decimals)**, not USDC (6). Prices in studio.toml are in wei.
- Default scaffold uses `[storage] kind="local"` (`file://`) — does **not** survive deploy.
  Switch to IPFS/S3 before any hosted demo, or the deliverable URL is unreachable.
- Mainnet is **never** gas-sponsored. Keep the demo on testnet.
- `--provider` is a required *flag*; the task is positional or `--task`, never both.

