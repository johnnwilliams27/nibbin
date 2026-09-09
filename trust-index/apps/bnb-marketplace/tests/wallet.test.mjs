import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as api from '../src/lib/wallet.ts';
const account = '0x1234567890123456789012345678901234567890';

test('connecting requests account access only and reads chain without signing or sending', async () => {
  assert.equal(typeof api.connectWallet, 'function');
  const calls = [];
  const provider = { request: async (request) => {
    calls.push(request);
    if (request.method === 'eth_requestAccounts') return [account];
    if (request.method === 'eth_chainId') return '0x38';
    throw new Error('Unexpected wallet method');
  } };
  assert.deepEqual(await api.connectWallet(provider), { account, chainId: 56 });
  assert.deepEqual(calls, [{ method: 'eth_requestAccounts' }, { method: 'eth_chainId' }]);
});

test('malformed account or chain responses cannot become a connected wallet', async () => {
  for (const accounts of [[], ['bad'], null]) {
    await assert.rejects(() => api.connectWallet({ request: async ({ method }) => method === 'eth_requestAccounts' ? accounts : '0x38' }));
  }
  assert.equal(api.parseChainId('not-a-chain'), null);
  assert.equal(api.parseChainId('0x61'), 97);
  assert.equal(api.parseChainId('0x1'), 1);
});

test('switching is restricted to BNB chains and never auto-adds an unconfigured network', async () => {
  const calls = [];
  await api.switchBnbChain({ request: async (r) => { calls.push(r); return null; } }, 97);
  assert.deepEqual(calls, [{ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x61' }] }]);
  await assert.rejects(() => api.switchBnbChain({ request: async () => { throw new Error('should not request'); } }, 1), /BNB/);
});

test('wallet rejection and missing-chain errors give safe actionable messages without raw provider text', () => {
  assert.match(api.walletError({ code: 4001, message: 'sensitive provider data' }), /cancelled/i);
  assert.match(api.walletError({ code: 4902 }), /add/i);
  assert.doesNotMatch(api.walletError(new Error('<script>raw error</script>')), /script/);
});

test('ambiguous wallet failures never claim that no transaction happened', () => {
  for (const error of [{ code: -32603 }, new Error('disconnected'), { code: 4001 }, { code: 4902 }]) {
    assert.doesNotMatch(api.walletError(error), /No transaction was requested/i);
  }
  assert.match(api.walletError({ code: -32603 }), /activity.*before.*retry/i);
});

test('send failures and missing hashes preserve the unknown-submission warning', async () => {
  assert.equal(typeof api.requestTransactionHash, 'function');
  for (const request of [async () => { throw new Error('transport closed'); }, async () => null]) {
    await assert.rejects(() => api.requestTransactionHash({ request }, {}), /wallet activity.*before retrying/i);
  }
  const rejected = { code: 4001 };
  await assert.rejects(() => api.requestTransactionHash({ request: async () => { throw rejected; } }, {}), (error) => error === rejected);
});

test('connection errors name the failing account or network stage and retain original cause without retrying', async () => {
  for (const [failingMethod, stage, expectedCalls] of [['eth_requestAccounts', 'requesting wallet account', ['eth_requestAccounts']], ['eth_chainId', 'reading wallet network', ['eth_requestAccounts', 'eth_chainId']]]) {
    const cause = new RangeError('Maximum call stack size exceeded');
    const calls = [];
    const provider = { request: async ({ method }) => { calls.push(method); if (method === failingMethod) throw cause; return [account]; } };
    await assert.rejects(() => api.connectWallet(provider), (error) => {
      assert.match(error.message, new RegExp(stage));
      assert.match(error.message, /Maximum call stack size exceeded/);
      assert.equal(error.cause, cause);
      return true;
    });
    assert.deepEqual(calls, expectedCalls);
  }
});

test('connection diagnostics preserve coded rejection identity and label discovery failures', async () => {
  assert.equal(typeof api.walletConnectionError, 'function');
  const cause = new RangeError('Maximum call stack size exceeded');
  const discovery = api.walletConnectionError(cause, 'finding browser wallet');
  assert.match(discovery.message, /finding browser wallet/);
  assert.equal(discovery.cause, cause);
  for (const code of [4001, -32002, 4902]) {
    const error = { code, message: 'Wallet response' };
    assert.equal(api.walletConnectionError(error, 'finding browser wallet'), error);
    await assert.rejects(() => api.connectWallet({ request: async () => { throw error; } }), (caught) => caught === error);
  }
});
