# Nibbin reference seller

A separate Node/Vercel service for the **Nibbin-owned health-factor reference demonstration**. It is not independently rated. It calculates from supplied numbers; it does not read real positions, monitor markets, execute trades, or protect against liquidation.

## Deploy

Deploy this directory as its own Vercel project (framework: Other). Do not change the marketplace's static-export configuration or add a repository-root `vercel.json`.

Required environment:

- `REFERENCE_SELLER_PRIVATE_KEY`: a fresh, dedicated signing key supplied only through Vercel's secret environment. Never commit or print it. Never use a buyer's wallet key.
- `REFERENCE_CHAIN_ID`: `97` initially. Only `97` and `56` are supported.
- `REFERENCE_SELLER_ORIGIN`: the stable public HTTPS origin of this seller project, with no path or credentials.

Limits:

- Price and accepted job budget are **zero**. Mainnet still costs real gas.
- `REFERENCE_MAX_SUBMISSIONS`: lifetime outgoing-transaction/nonce ceiling, default and maximum 100 on testnet; default and maximum 3 on mainnet. Pending nonce is checked again immediately before signing. Using the key elsewhere consumes this ceiling; do not reset or reuse it to evade the limit.
- `REFERENCE_ALLOWED_BUYERS`: comma-separated addresses. Mandatory on mainnet. Checked against the actual on-chain job client, never a caller-supplied address. Optional on testnet.
- `REFERENCE_MAX_GAS_WEI`: maximum gas limit × fee cap per mainnet transaction; default 100000000000000 wei (0.0001 BNB), hard maximum 500000000000000 wei (0.0005 BNB). Values exceeding the ceiling fail closed. The default mainnet lifetime ceiling is therefore at most 0.0003 BNB for the permitted three transactions; changing the per-tx cap can raise this to at most 0.0015 BNB. The dedicated wallet's actual funding provides an additional bound.
- Before signing a mainnet quote, the service verifies RPC chain 56, a pending nonce below its lifetime cap and a pending native balance of at least one configured maximum-gas reserve. An unfunded or exhausted seller refuses the quote explicitly. This is a readiness check at quote time, not a reservation against subsequent transactions. Sponsored testnet quotes do not require a native balance.
- The signer permits only `submit(uint256,bytes32,bytes)` to the canonical chain's commerce contract, with zero native value. No transfers, approvals, arbitrary targets or other signing APIs.

Deploy mainnet as a **separate project with a separate stable URL and fresh dedicated key**. Do not flip the existing testnet service to mainnet: that would break published testnet result URLs. Keep historical `/result/v1` computation unchanged; a new calculation version needs a new route.

## Interface

`GET /.well-known/agent-card.json` returns the labelled reference card and actual configured provider address. `GET /api/agent` returns the same card. An unconfigured signing service returns 503 rather than an invented provider.

`POST /api/agent` uses A2A `message/send`:

```json
{
  "jsonrpc": "2.0", "id": "quote-1", "method": "message/send",
  "params": { "message": { "kind": "message", "role": "user", "messageId": "quote-1", "parts": [
    { "kind": "data", "data": { "skill": "negotiate", "task_description": "collateral=12500 debt=6200 threshold=0.825" } }
  ] } }
}
```

The reply `result.parts[0].data` is the official SDK `NegotiationResult.toDict()` envelope. It carries an EIP-191 provider signature over the canonical-content hash **as a hex string**, bound to chain, commerce contract, currency and a 900-second quote window. Use the SDK's `buildJobDescription()` or the marketplace's verified equivalent before funding.

After the buyer funds the signed zero-price job, send `{ "skill": "notify_funded", "job_id": 123, "funding_tx_hash": "0x..." }` in the DataPart. The hash must be the actual confirmed **fund** transaction, not creation or budget-setting. The seller retrieves that one receipt, checks its successful canonical `JobFunded` event, exact job ID, buyer, provider, zero amount, canonical block hash and timestamp within the signed quote window. It does not scan historical logs. Missing proof is an actionable error. The handler also verifies the canonical router, signature and remaining submission time before submitting. It awaits submission and verifies the saved digest before claiming success. There is no fire-and-forget background work. An uncertain error is not success: read the on-chain status before retrying. Concurrent same-wallet requests can collide on nonce; this can cause a retryable failure but cannot exceed the lifetime nonce ceiling.

On testnet the seller additionally refuses to sign any nonzero gas-price transaction, including an SDK self-payment fallback. Sponsorship failure cannot silently consume a funded testnet wallet.

`health_factor_v1` with the same `task_description` computes a read-only preview without a transaction.

## Durable results without ephemeral storage

`GET /result/v1/97/123` reconstructs the exact version-1 manifest from the job's immutable signed description and deterministic fixed-point calculation. The response is served **only** if its canonical hash matches the saved on-chain deliverable and the job is submitted/completed. No `/tmp` files or instance memory are needed. This is reproducibility from on-chain inputs, not a promise that Vercel or the RPC can never be unavailable. Keep the service and versioned implementation online.

External calls use only fixed BNB RPC and MegaFuel destinations. Request URLs are never fetched. CORS allows only `https://nibbin.com`, `https://www.nibbin.com`, and localhost ports 3000/3100; CORS is not treated as authentication. On-chain provider/buyer checks and signing limits are the security boundary.

## Verify

`npm ci --ignore-scripts` then `npm test`. Tests use a publicly known, unfunded test-only key and no live chain writes. Production deployment and an actual funded-job smoke test are separate release checks; passing offline tests does not claim either occurred.
