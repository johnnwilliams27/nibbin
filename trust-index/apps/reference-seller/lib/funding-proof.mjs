import { decodeEventLog } from 'viem';

/** A receipt is a bounded proof of one funding event; no historical log scanning. */
export async function fundingBlockFromReceipt(publicClient, hash, job, quote, commerce, abi) {
  if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('Funding proof requires funding_tx_hash: supply the confirmed fund transaction hash.');
  const receipt = await publicClient.getTransactionReceipt({ hash });
  if (receipt.status !== 'success' || String(receipt.transactionHash).toLowerCase() !== hash.toLowerCase()
    || String(receipt.to).toLowerCase() !== commerce.toLowerCase()
    || String(receipt.from).toLowerCase() !== String(job.client).toLowerCase()
    || receipt.blockNumber === undefined || receipt.blockNumber === null || !receipt.blockHash) throw new Error('Funding proof receipt does not match the successful buyer transaction.');
  const matches = [];
  for (const log of receipt.logs ?? []) {
    if (log.removed || String(log.address).toLowerCase() !== commerce.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics, strict: true });
      if (decoded.eventName !== 'JobFunded') continue;
      const args = decoded.args;
      if (BigInt(args.jobId) === BigInt(job.id) && String(args.client).toLowerCase() === String(job.client).toLowerCase()
        && String(args.provider).toLowerCase() === String(job.provider).toLowerCase() && BigInt(args.amount) === 0n && BigInt(job.budget) === 0n) matches.push(args);
    } catch { /* Other contract events are not a funding proof. */ }
  }
  if (matches.length !== 1) throw new Error('Funding proof does not contain the exact zero-budget JobFunded event.');
  const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
  if (String(block.hash).toLowerCase() !== String(receipt.blockHash).toLowerCase()
    || block.timestamp < BigInt(quote.negotiated_at) || block.timestamp >= BigInt(quote.quote_expires_at)) throw new Error('Funding proof is not canonical or falls outside the signed quote window.');
  return receipt.blockNumber;
}
