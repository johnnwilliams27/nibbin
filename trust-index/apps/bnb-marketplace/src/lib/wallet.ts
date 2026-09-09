export type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
};
export type WalletState = { account: string; chainId: number };

export function parseChainId(value: unknown): number | null {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) return null;
  const n = Number.parseInt(value.slice(2), 16);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function walletAccount(value: unknown): string | null {
  return Array.isArray(value) && typeof value[0] === 'string' && /^0x[0-9a-f]{40}$/i.test(value[0]) ? value[0] : null;
}

/** Preserve provider error codes and the original cause without logging wallet data. */
export function walletConnectionError(error: unknown, stage: 'finding browser wallet' | 'requesting wallet account' | 'reading wallet network'): unknown {
  if (typeof error === 'object' && error !== null && 'code' in error) return error;
  const detail = error instanceof Error ? error.message.slice(0, 220) : 'The wallet did not complete this step.';
  return new Error(`Wallet connection failed while ${stage}: ${detail}`, { cause: error });
}

/** Call only from a user's Connect action. No signature, allowance, or transaction. */
export async function connectWallet(provider: Eip1193Provider): Promise<WalletState> {
  let account: string;
  try {
    const result = walletAccount(await provider.request({ method: 'eth_requestAccounts' }));
    if (!result) throw new Error('No usable account returned');
    account = result;
  } catch (error) { throw walletConnectionError(error, 'requesting wallet account'); }
  let chainId: number;
  try {
    const result = parseChainId(await provider.request({ method: 'eth_chainId' }));
    if (result === null) throw new Error('No usable network returned');
    chainId = result;
  } catch (error) { throw walletConnectionError(error, 'reading wallet network'); }
  return { account, chainId };
}

export async function switchBnbChain(provider: Eip1193Provider, chainId: number): Promise<void> {
  if (chainId !== 56 && chainId !== 97) throw new Error('Only BNB networks are supported');
  await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainId === 56 ? '0x38' : '0x61' }] });
}

export function walletError(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
  if (code === 4001) return 'Request cancelled in your wallet. Check any earlier transaction receipts before continuing.';
  if (code === 4902) return 'Add this BNB network in your wallet using its trusted network list, then try switching again.';
  if (code === -32002) return 'A wallet request is already open. Finish or cancel it in your wallet before trying again.';
  return 'The wallet request did not finish with a confirmed outcome. Check wallet activity and on-chain job state before retrying; a transaction may already have been sent.';
}

/** The wallet can broadcast before its transport fails; never call that a failed send. */
export async function requestTransactionHash(provider: Eip1193Provider, transaction: Record<string, unknown>): Promise<`0x${string}`> {
  let hash: unknown;
  try { hash = await provider.request({ method: 'eth_sendTransaction', params: [transaction] }); }
  catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 4001) throw error;
    throw new Error('Transaction outcome is unknown. Check wallet activity and on-chain job state before retrying; the wallet may already have sent it.');
  }
  if (typeof hash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error('Wallet returned no transaction hash. Check wallet activity and on-chain job state before retrying; the transaction outcome is unknown.');
  return hash as `0x${string}`;
}
