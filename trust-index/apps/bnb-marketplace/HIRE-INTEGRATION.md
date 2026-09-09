# Hire integration — ERC-8183 on BNB Smart Chain

How the marketplace front end turns "hire this agent" into on-chain reality.
Everything below was executed for real on **BSC testnet (chain 97)** on 2026-09-09.
Total spend: **$0.00**.

Companion doc: `SPIKE-8183.md` (the feasibility spike and its tx hashes).

---

## 1. Contracts

**BSC Testnet — chain_id `97`** (what we tested)

| Role | Address |
|---|---|
| **commerceProxy** — the ERC-8183 contract you call to hire | `0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE` |
| policy — dispute window + `dispute()` | `0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA` |
| router / evaluator | `0xD7d36D66d2F1B608A0F943f722D27e3744f66F25` |
| paymentToken **U** | `0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565` |

**BSC Mainnet — chain_id `56`**

| Role | Address |
|---|---|
| commerceProxy | `0xEa4DAa3100A767e86FDed867729ae7446476EBA6` |
| router | `0x51895229E12F9876011789B04f8698af06cCD6DA` |
| paymentToken U | `0xcE24439F2D9C6a2289F741120FE202248B666666` |

Source of truth: `@bnbagent/sdk/networks` → `BNB_CHAIN_ADDRESSES`. **Import the ABI from
`@bnbagent/sdk` — do not hand-roll it.** Observed selectors, for orientation only:

```
createJob(address,address,uint256,string,address)
registerJob(uint256,address)
setBudget(uint256,uint256,bytes)
fund(uint256,uint256,bytes)
submit(uint256,bytes32,bytes)     // seller
dispute(uint256)                  // on the POLICY contract, not commerce
```

---

## 2. A hire is four transactions, not one

`bag erc8183 buy` is a wrapper around this sequence against **commerceProxy**:

1. `createJob(provider, expiredAt, description)` → `job_id`
2. `registerJob(jobId)`
3. `setBudget(jobId, rawBudget)`
4. `fund(jobId, rawBudget, approveFloor)` — for a **paid** job this is preceded by an
   ERC-20 `approve` on the U token. For `budget = 0` there is **no approve and no escrow**.

A front end that wants one-click hire must either batch these or drive four wallet
confirmations. **There is no single `hire()` entrypoint.**

### The description must carry a seller-signed quote
`createJob`'s `description` is not free text. The seller's `submit` **refuses** a job whose
description lacks a valid signed quote:

```
Job verification failed: Job description does not contain a signed negotiation quote
```

So the real hire flow is **five** steps: negotiate off-chain first, then the four txs.
The description we successfully anchored:

```json
{"chain_id":97,"currency":"0xc70B...5565","negotiated_at":1788924562,
 "negotiation_hash":"0x8268cf...","price":"0","provider_sig":"0x0138c8...",
 "quote_expires_at":1788925462,"task":"...","terms":{...},
 "verifying_contract":"0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE","version":1}
```

`chain_id` + `verifying_contract` are bound into `provider_sig`, so a quote cannot be
replayed onto another chain or contract. Quote TTL is **900 s** — the UI must
negotiate and fund inside 15 minutes or re-negotiate.

---

## 3. Getting the signed quote (A2A `negotiate`)

`POST` to the seller's A2A endpoint. The skill envelope rides in a **DataPart**:

```bash
curl -X POST http://<seller-host>/ -H 'Content-Type: application/json' -d '{
 "jsonrpc":"2.0","id":"neg-1","method":"message/send",
 "params":{"message":{"role":"user","messageId":"m1","kind":"message",
  "parts":[{"kind":"data","data":{
    "skill":"negotiate",
    "task_description":"Compute the lending health factor for collateral=12500 debt=6200 threshold=0.825",
    "terms":{"deliverables":"health factor value, risk band, and the arithmetic used",
             "quality_standards":"deterministic arithmetic, show the formula"}}}]}}}'
```

Both `terms` keys are **required**. The reply's data part *is* the quote envelope —
pass it verbatim as `createJob`'s description (the CLI takes it via `--quote-json`).
The negotiate path is deterministic seller-side code (price from config, clamped, EIP-191
signed). **No LLM is involved and no LLM key is needed to quote.**

After funding, tell the seller to work:

```json
{"skill":"notify_funded","job_id":1163}
```

It acks `accepted` immediately and delivers in the background. **Do not wait on this call** —
poll the chain for `SUBMITTED`.

---

## 4. ⭐ Can hiring be driven from a browser?

**Yes — the on-chain half is ordinary EVM. But not for free, and not against our current
sellers.** Honest breakdown:

| Piece | Browser-viable? | Notes |
|---|---|---|
| `createJob` / `registerJob` / `setBudget` / `fund` | ✅ **Yes** | Plain contract writes. wagmi/viem + WalletConnect/MetaMask on chain 97. Nothing CLI-specific. |
| ERC-20 `approve` (paid jobs only) | ✅ Yes | Standard. Skipped entirely when `budget = 0`. |
| `negotiate` / `notify_funded` HTTPS calls | ⚠️ Conditional | Needs the seller on **public HTTPS with CORS**. Our reference agents are currently **localhost-only**. |
| **Gas sponsorship** | ❌ **No** | This is the catch — see below. |

### The gas-sponsorship catch (the important one)
Our $0 spend came from the **MegaFuel paymaster**, which the *SDK* uses by routing the
signed raw tx through `https://bsc-megafuel-testnet.nodereal.io`. A browser wallet
broadcasts through **its own** RPC, so it will not pick up sponsorship. In a browser the
user pays their own gas and therefore **needs tBNB** — which on testnet means the
Telegram faucet.

Two honest ways out:
- **(a) Sponsored relay.** The dApp builds and has the user *sign* the tx, then the front
  end (or a thin backend) submits the raw tx to the MegaFuel endpoint itself instead of
  letting the wallet broadcast. This preserves $0 hire. Not yet built or tested by us.
- **(b) Accept user-paid gas.** Simplest, works today, but every demo user needs tBNB.

### Verdict for the judges' "activate an agent from the web app" requirement
**Achievable, and it should be built as a real browser flow** — the contract calls are
nothing exotic. The two things standing between us and a genuine one-click web hire are
(1) a **publicly reachable seller** and (2) a decision on **who pays gas**. Neither is a
protocol limitation.

**If the deadline arrives before that is wired**, the honest fallback — in descending order
of integrity, do *not* dress any of these up as more than they are:
1. **Browser hire with user-paid gas** on testnet, seller behind a public HTTPS tunnel.
   This is a real end-to-end activation; only the sponsorship is missing.
2. **UI prepares the unsigned transactions** and shows them for wallet signature.
3. **UI generates the exact `bag` command** with the agent's address pre-filled, and shows
   the resulting tx hashes / BscScan links. Label it plainly as a CLI-assisted hire.

Do **not** ship a button that fakes a hire or replays our recorded tx hashes as if they
were the user's.

---

## 5. Full working loop (copy-pasteable, testnet, $0)

```bash
# ---- one-time setup ----
npm install @bnbagent/studio-cli@0.0.13
npx bag init myagent --destination self --network bsc-testnet \
  --no-onboard --no-install --no-auto-topup --ide claude-code
cd myagent
# WALLET_PASSWORD must be persisted in .studio/.env.local — the CLI refuses it
# on argv and `bag env set` rejects the key by name.
bag wallet new                    # or: bag wallet new --private-key -   (stdin)
bag config set payments.erc8183.price 0     # FREE quotes; no U, no escrow
pnpm install

# ---- run the seller (terminal 1) ----
ERC8183_AGENT_URL=http://127.0.0.1:9000/erc8183 bag dev --port 9000

# ---- hire (terminal 2) ----
# 1. negotiate → signed quote
curl -s -X POST http://127.0.0.1:9000/ -H 'Content-Type: application/json' \
  -d @negreq.json > negresp.json
node -e 'const r=require("./negresp.json");require("fs").writeFileSync("quote.json",
  JSON.stringify(r.result.parts.find(p=>p.kind==="data").data,null,2))'

# 2. buy — the 4 on-chain txs (run from the BUYER project)
bag erc8183 buy --provider <SELLER_ADDR> --quote-json ./quote.json \
  --budget-u 0 --deadline-min 20 --network bsc-testnet

# 3. activate the agent
curl -s -X POST http://127.0.0.1:9000/ -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"nf","method":"message/send","params":{"message":
      {"role":"user","messageId":"m2","kind":"message","parts":[{"kind":"data",
       "data":{"skill":"notify_funded","job_id":<JOB_ID>}}]}}}'

# 4. read result + settle
bag erc8183 status <JOB_ID>          # FUNDED → SUBMITTED
bag erc8183 fetch  <JOB_ID>          # deliverable_url
bag erc8183 settle <JOB_ID> --action approve    # after the dispute window
```

---

## 6. Gas sponsorship: exactly what is and is not covered

Measured, not assumed. `wallet_paid_wei: 0` on every commerce write:

| Operation | Contract | Sponsored on testnet? |
|---|---|---|
| `createJob`, `registerJob`, `setBudget`, `fund` | commerceProxy | ✅ **Yes** (`effective_gas_price_wei: 0`) |
| `submit` (seller) | commerceProxy | ✅ **Yes** (gas_used ~199k, paid 0) |
| `settle --action approve` | **router** | ✅ **Yes** (gas_used 85657, paid 0) |
| `settle --action dispute` | **policy** | ❌ **No** — `insufficient funds ... have 0 want 180322000000000` |
| `erc8004 register` | ERC-8004 registry | ❌ **No** — CLI pre-checks and needs ~0.002 tBNB |

**The whole happy path — hire → deliver → approve → COMPLETED — is fully sponsored and
costs the user nothing.** Only `dispute` (policy contract) and ERC-8004 identity
registration require real tBNB. Mainnet is **never** sponsored, and a custom stack selected
via `ERC8183_*_ADDRESS` overrides is not sponsored either.

This matters for the UI: the unhappy path (dispute) is the one that needs a funded wallet.
Budget for that, or the dispute button will fail for an unfunded user.

---

## 7. Reference agents — status and integrity

**We deployed ONE genuinely working reference agent, not three. That is deliberate.**

| Field | Value |
|---|---|
| category | `health_factor` |
| owner_address / provider | `0x6d46b2415b9339A1aC8E5Cc80fDA147f2701B7e8` |
| chain_id | `97` (BSC testnet) |
| token_id | **`null` — not ERC-8004 registered** (registration is unsponsored; needs ~0.002 tBNB) |
| endpoint | `http://127.0.0.1:9000` — **local only, not publicly reachable** |
| is_reference_agent | **`true`** |
| assessment | **`null`** — we do not score our own agents |
| what it actually does | Deterministic health factor: `(collateral × threshold) / debt`, plus risk band and headroom. No LLM, no external data. Source: `app/agent/src/unifiedMain.ts` → `buildRunWork()` |

Jobs it really completed: **1162** (manual submit) and **1163** (fully autonomous —
negotiated, funded, activated, delivered, submitted on-chain, gas paid 0).

### Why only one, and why no token_id
- **ERC-8004 registration is not gas-sponsored.** Every reference agent needs ~0.002 tBNB,
  which requires the Telegram faucet and therefore a human. Blocked, not skipped.
- Standing up two more agents in `rebalancing` / `grid_trading` / `yield` that do not
  actually compute anything would be **exactly the padding this marketplace criticises**.
  One agent that genuinely works beats three that look good in a list.

### Rules for the data pipeline (non-negotiable)
1. `is_reference_agent: true` ⇒ **excluded from every ranking, sort, and leaderboard**, and
   visibly labelled in the UI (`DATA-CONTRACT.md` rule 2).
2. `assessment: null` — we run the ratings **and** entered this agent. It gets no score.
   Never backfill one.
3. `token_id` is `null` until a funded ERC-8004 registration exists. The contract types it
   as `string`; the pipeline needs a nullable variant or must hold the agent back.
   **Do not mint a placeholder id.**
4. `endpoint` is local — set `x402_supported: false` and do not advertise it as callable
   until it is publicly deployed.

---

## 8. Gotchas that will cost you an hour each

- **U has 18 decimals, not 6.** It is *not* USDC. `[payments.erc8183].price` is in **wei**:
  `"100000000000000000"` = 0.1 U. Getting this wrong is a 10¹²× pricing error.
- **`[storage] kind = "local"` writes a `file://` URL the chain will not accept**, and with
  `ERC8183_AGENT_URL` set it records an HTTP URL that **still does not resolve** (the
  `/erc8183` route is not served by the A2A face). Our job 1163 has a real on-chain
  `deliverable_url` that 404s; the manifest lives at
  `file:///root/.bag/deliverables/app/erc8183-job-1163.json`. **Switch to IPFS/S3/Blob
  before any public demo** or buyers cannot read what they paid for.
- **Dispute window is 900 s (15 min), not 24 h.** The bundled docs say 24 h; the deployed
  testnet policy contract returns `disputeWindow() = 900`. Read it from the chain, never
  hard-code it. Approving early reverts `0x17be5b7b`.
- **`--provider` is a required flag**, not positional; the task is positional *or* `--task`,
  never both.
- **`expired_at = now + deadline_minutes·60 + disputeWindow`**, and submission must land
  before `expired_at − disputeWindow`.
- **The front end MUST send `notify_funded`; the seller will not notice on its own.**
  The docs claim the seller also sweeps other funded jobs in the background. On our run
  that sweep is **broken**: right after job 1163 submitted successfully, the runtime logged
  `[ERC8183JobOps] get_pending_jobs failed: Failed to connect to RPC:
  data-seed-prebsc-2-s2.binance.org:8545 (timed out)` — the same dead default RPC as below,
  and we found no env override that fixes that code path. Consequence: **a UI that funds a
  job and then waits passively will hang forever.** Buyer-push (`notify_funded`) is the only
  delivery trigger that actually works today. Treat it as a required step, not an optimisation.
- **The default SDK RPC is dead.** `ERC8183Client.create` defaults to
  `data-seed-prebsc-2-s2.binance.org:8545` (times out) and `ERC8183ClientCreateOpts` has no
  `rpcUrl` field — pass a full `NetworkConfig` to override. The `bag` CLI resolves a working
  RPC on its own. Known-good: `https://bsc-testnet-dataseed.bnbchain.org`.
- **Never commit `.studio/.env.local` or `.studio/wallets/`.** They hold the password and
  keystore.
