import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobReader } from '../lib/chain.mjs';
const hash=`0x${'ab'.repeat(32)}`;
test('job read is pinned to finalized block and block hash is rechecked',async()=>{
 const calls=[];const client={getChainId:async()=>97,getBlock:async args=>{calls.push(args);return {number:123n,hash};},readContract:async args=>{assert.equal(args.blockNumber,123n);assert.equal(args.address,'0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de');assert.deepEqual(args.args,[1179n]);return {id:1179n};}};
 const result=await createJobReader(client)('1179');assert.equal(result.blockHash,hash);assert.deepEqual(calls,[{blockTag:'finalized'},{blockNumber:123n}]);
});
test('wrong RPC network fails closed before job reading',async()=>{await assert.rejects(()=>createJobReader({getChainId:async()=>56})('1179'),/chain mismatch/);});
test('changed block hash fails closed',async()=>{let reads=0;await assert.rejects(()=>createJobReader({getChainId:async()=>97,getBlock:async()=>({number:123n,hash:reads++?`0x${'cd'.repeat(32)}`:hash}),readContract:async()=>({id:1179n})})('1179'),/changed/);});
