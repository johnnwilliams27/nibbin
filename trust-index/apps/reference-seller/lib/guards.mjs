const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ALLOWED_ORIGINS = new Set(['https://nibbin.com', 'https://www.nibbin.com', 'http://localhost:3000', 'http://localhost:3100']);

export function isAllowedOrigin(origin) { return ALLOWED_ORIGINS.has(origin); }

export function parseJobId(value) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new Error('Invalid job ID.');
  return Number(value);
}

export function sellerConfig(env) {
  const chainId = Number(env.REFERENCE_CHAIN_ID ?? '97');
  if (![56, 97].includes(chainId)) throw new Error('Only BSC mainnet and testnet are supported.');
  const allowedBuyers = (env.REFERENCE_ALLOWED_BUYERS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allowedBuyers.some((address) => !ADDRESS.test(address))) throw new Error('Invalid buyer allowlist.');
  if (chainId === 56 && allowedBuyers.length === 0) throw new Error('Mainnet is disabled until a buyer allowlist is configured.');
  const maxSubmissions = Number(env.REFERENCE_MAX_SUBMISSIONS ?? (chainId === 56 ? '3' : '100'));
  if (!Number.isSafeInteger(maxSubmissions) || maxSubmissions < 1 || maxSubmissions > (chainId === 56 ? 3 : 100)) throw new Error('Invalid lifetime transaction cap.');
  const rawGas = env.REFERENCE_MAX_GAS_WEI ?? '100000000000000';
  if (!/^\d+$/.test(rawGas)) throw new Error('Invalid gas budget.');
  const maxGasWei = BigInt(rawGas);
  if (maxGasWei <= 0n || maxGasWei > 500000000000000n) throw new Error('Per-transaction gas budget exceeds hard cap.');
  return { chainId, allowedBuyers, maxSubmissions, maxGasWei };
}

export function assertJobIdentity(job, provider, config) {
  if (String(job.provider).toLowerCase() !== provider.toLowerCase()) throw new Error('Job belongs to another provider.');
  if (BigInt(job.budget) !== 0n) throw new Error('This reference accepts zero-budget jobs only.');
  if (config.allowedBuyers.length && !config.allowedBuyers.includes(String(job.client).toLowerCase())) throw new Error('Buyer is not enabled for this reference demonstration.');
}

/** The fresh seller key cannot sign transfers, approvals or arbitrary contract calls. */
export function assertSubmissionTransaction(tx, config, commerce, selector, pendingNonce) {
  if (Number(tx.chainId) !== config.chainId || String(tx.to).toLowerCase() !== commerce.toLowerCase()
    || BigInt(tx.value ?? 0) !== 0n || typeof tx.data !== 'string' || !tx.data.startsWith(selector)) throw new Error('Only the configured zero-value result submission may be signed.');
  if (!Number.isSafeInteger(pendingNonce) || pendingNonce < 0 || !Number.isSafeInteger(Number(tx.nonce)) || Number(tx.nonce) !== pendingNonce
    || pendingNonce >= config.maxSubmissions || Number(tx.nonce) >= config.maxSubmissions) throw new Error('Reference seller lifetime transaction limit reached.');
  if (config.chainId === 97 && (tx.gasPrice === undefined || BigInt(tx.gasPrice) !== 0n || BigInt(tx.maxFeePerGas ?? 0) !== 0n || BigInt(tx.maxPriorityFeePerGas ?? 0) !== 0n)) throw new Error('Testnet reference submission requires sponsored gas; self-payment is disabled.');
  if (config.chainId === 56) {
    const fee = tx.maxFeePerGas ?? tx.gasPrice;
    if (tx.gas === undefined || fee === undefined || BigInt(tx.gas) <= 0n || BigInt(fee) <= 0n
      || BigInt(tx.gas) * BigInt(fee) > config.maxGasWei) throw new Error('Transaction exceeds the mainnet gas budget.');
  }
}
