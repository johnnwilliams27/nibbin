import { createRuntime } from '../lib/runtime.mjs';
import { isAllowedOrigin } from '../lib/guards.mjs';
import { calculate } from '../lib/calculation.mjs';

export function createHandler(runtimeFactory = createRuntime) {
return async function handler(req, res) {
  const origin = req.headers.origin;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Vary', 'Origin');
  if (origin && !isAllowedOrigin(origin)) return res.status(403).json({ error: 'Origin is not allowed.' });
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Use GET or POST.' });
  let runtime;
  try { runtime = runtimeFactory(); } catch {
    return res.status(503).json({ error: 'Reference seller is not configured. No signing or submission is available.' });
  }
  try {
    if (req.method === 'GET') {
      if (req.query?.route === 'result') {
        if (String(req.query.chain) !== String(runtime.config.chainId)) return res.status(400).json({ error: 'This seller is configured for another chain.' });
        const result = await runtime.seller.result(req.query.job);
        // No public response is trusted unless it matches the persisted on-chain digest.
        return res.status(200).json(result);
      }
      return res.status(200).json(runtime.seller.card());
    }
    if (Number(req.headers['content-length'] ?? 0) > 16384) return res.status(413).json({ error: 'Request too large.' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!body || JSON.stringify(body).length > 16384 || body.jsonrpc !== '2.0' || body.method !== 'message/send') return res.status(400).json({ error: 'Send a bounded A2A message/send request.' });
    const parts = body.params?.message?.parts;
    const input = Array.isArray(parts) ? parts.find((part) => part?.kind === 'data')?.data : null;
    if (!input || typeof input !== 'object' || Array.isArray(input)) return res.status(400).json({ error: 'A skill DataPart is required.' });
    let data;
    if (input.skill === 'negotiate') data = await runtime.seller.negotiate(input);
    else if (input.skill === 'notify_funded') data = await runtime.seller.notifyFunded(input.job_id, input.funding_tx_hash);
    else if (input.skill === 'health_factor_v1') data = calculate(input.task_description);
    else return res.status(400).json({ error: 'Unsupported reference skill.' });
    return res.status(200).json({ jsonrpc: '2.0', id: body.id ?? null,
      result: { kind: 'message', role: 'agent', messageId: `reference-${Date.now()}`, parts: [{ kind: 'data', data }] } });
  } catch (error) {
    // SDK errors can contain RPC URLs and transaction payloads. Never expose them or signing state.
    const allowedMessages = ['Use collateral=', 'Task must ', 'Use positive ', 'Unsupported task.', 'Collateral and debt ',
      'Invalid job ID.', 'Job belongs ', 'This reference ', 'Buyer is not ', 'The job must ', 'The job does not ',
      'No funding ', 'The on-chain provider ', 'The submission deadline ', 'Reference seller lifetime ',
      'No submitted result ', 'Published result digest ', 'Only the canonical ', 'RPC chain mismatch.', 'Funding proof ', 'Mainnet seller '];
    const message = typeof error?.message === 'string' && allowedMessages.some((prefix) => error.message.startsWith(prefix))
      ? error.message : 'Reference operation could not complete. No successful submission is claimed; check the on-chain job status before retrying.';
    return res.status(400).json({ jsonrpc: '2.0', id: req.body?.id ?? null, error: { code: -32000, message } });
  }
}
}

export default createHandler();
