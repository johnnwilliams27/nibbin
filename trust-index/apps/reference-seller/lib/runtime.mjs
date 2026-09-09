import { createPublicClient, http, toFunctionSelector } from 'viem';
import { bsc, bscTestnet } from 'viem/chains';
import { EVMWalletProvider } from '@bnbagent/sdk/wallets';
import { BNB_CHAIN_ADDRESSES } from '@bnbagent/sdk/networks';
import { CommerceClient, RouterClient, PolicyClient, ERC8183Client } from '@bnbagent/sdk/erc8183';
import { sellerConfig, assertSubmissionTransaction } from './guards.mjs';
import { createSeller } from './seller.mjs';

export function createRuntime(env = process.env) {
  const config = sellerConfig(env);
  if (!/^0x[0-9a-fA-F]{64}$/.test(env.REFERENCE_SELLER_PRIVATE_KEY ?? '')) throw new Error('Reference signer is not configured.');
  const origin = new URL(env.REFERENCE_SELLER_ORIGIN ?? (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : ''));
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Configure a canonical public HTTPS origin.');
  const addresses = BNB_CHAIN_ADDRESSES[config.chainId];
  const rpcUrl = config.chainId === 97 ? 'https://bsc-testnet-dataseed.bnbchain.org' : 'https://bsc-dataseed.bnbchain.org';
  // Destinations are fixed operator-owned configuration, never subject URLs or request input.
  const publicClient = createPublicClient({ chain: config.chainId === 97 ? bscTestnet : bsc,
    transport: http(rpcUrl, { timeout: 8000, retryCount: 0,
      fetchOptions: { redirect: 'error', headers: { 'User-Agent': 'Nibbin Trust Index (https://nibbin.com)' } } }) });
  const wallet = new EVMWalletProvider({ privateKey: env.REFERENCE_SELLER_PRIVATE_KEY,
    password: 'in-memory-only-no-keystore-is-written', persist: false });
  const originalSignTransaction = wallet.signTransaction.bind(wallet);
  wallet.signTransaction = async (transaction) => {
    const pendingNonce = await publicClient.getTransactionCount({ address: wallet.address, blockTag: 'pending' });
    assertSubmissionTransaction(transaction, config, addresses.commerceProxy,
      toFunctionSelector('submit(uint256,bytes32,bytes)'), pendingNonce);
    return originalSignTransaction(transaction);
  };
  const network = { name: config.chainId === 97 ? 'bsc-testnet' : 'bsc-mainnet', chainId: config.chainId,
    rpcUrl, usePaymaster: config.chainId === 97,
    paymasterUrl: config.chainId === 97 ? 'https://bsc-megafuel-testnet.nodereal.io' : '',
    commerceContract: addresses.commerceProxy, routerContract: addresses.routerProxy, policyContract: addresses.policy };
  const paymaster = ERC8183Client.buildPaymaster(network, false);
  // SDK receiptTimeout is in seconds (not viem's millisecond convention).
  const options = { paymaster, receiptTimeout: 20 };
  const commerce = new CommerceClient(publicClient, addresses.commerceProxy, wallet, options);
  const router = new RouterClient(publicClient, addresses.routerProxy, wallet, options);
  const policy = new PolicyClient(publicClient, addresses.policy, wallet, options);
  const client = new ERC8183Client({ client: publicClient, network, walletProvider: wallet, debug: false, commerce, router, policy });
  const account = { address: wallet.address, signMessage: async ({ message }) => (await wallet.signMessage(message)).signature };
  return { config, seller: createSeller({ account, config, addresses, origin: origin.origin, publicClient, client }) };
}
