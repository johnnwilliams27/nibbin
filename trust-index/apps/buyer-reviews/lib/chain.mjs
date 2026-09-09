import { createPublicClient, http, parseAbi } from 'viem';
import { bscTestnet } from 'viem/chains';
import { COMMERCE,requireThat } from './protocol.mjs';
const abi=parseAbi(['function getJob(uint256 jobId) view returns ((uint256 id,address client,address provider,address evaluator,string description,uint256 budget,uint256 expiredAt,uint8 status,address hook,uint256 submittedAt,bytes32 deliverable))']);
// Fixed destination: neither requests nor arbitrary environment values can route RPC traffic.
export function createJobReader(client=createPublicClient({chain:bscTestnet,transport:http('https://bsc-testnet-dataseed.bnbchain.org',{timeout:8000,retryCount:0})})) {
 return async jobId=>{
  requireThat(await client.getChainId()===97,'RPC chain mismatch',503);
  const block=await client.getBlock({blockTag:'finalized'});requireThat(block.number!==null&&block.hash,'Finalized block unavailable',503);
  const job=await client.readContract({address:COMMERCE,abi,functionName:'getJob',args:[BigInt(jobId)],blockNumber:block.number});
  const checked=await client.getBlock({blockNumber:block.number});requireThat(checked.hash===block.hash,'Chain evidence changed',503);
  return {job,blockNumber:String(block.number),blockHash:block.hash};
 };
}
