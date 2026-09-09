import test from 'node:test';
import assert from 'node:assert/strict';
import { privateKeyToAccount } from 'viem/accounts';
import { createService } from '../lib/service.mjs';
const account = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const other = privateKeyToAccount(`0x${'22'.repeat(32)}`);
const input = {subject:'reference:97:health-factor',jobId:'1179',buyer:account.address,rating:4,comment:'Useful <b>plain text</b>'};
function setup(overrides = {}) {
  const challenges = new Map(); let result; let time = 1788946000;
  const store = {
    async putChallenge(c) { challenges.set(c.id,c); },
    async getChallenge(id) { return challenges.get(id); },
    async findReview() { return result; },
    async publish(c, signature, verification) { if(result) return {review:result,replayed:true}; result={...c,id:'1',createdAt:new Date(time*1000).toISOString(),signature,verification}; return {review:result,replayed:false}; },
  };
  const job = {id:1179n,client:account.address,provider:'0x6f736f824b27f686e6cc5dbd945f9727812a1c72',evaluator:'0xd7d36d66d2f1b608a0f943f722d27e3744f66f25',hook:'0xd7d36d66d2f1b608a0f943f722d27e3744f66f25',status:3};
  const service = createService({store,readJob:async()=>({job,blockNumber:'123',blockHash:`0x${'ab'.repeat(32)}`}),audience:'https://reviews.example',now:()=>time,...overrides});
  return {service,job,store,advance:()=>{time+=601;}};
}
test('accepts real buyer signature, stores completed review, and replays identical submission',async()=>{
  const {service}=setup(); const c=await service.challenge(input);
  assert.match(c.message,/^Nibbin buyer review v1\nAudience: https:\/\/reviews.example\n/);
  assert.ok(c.message.includes('Comment: "Useful <b>plain text</b>"'));
  const signature=await account.signMessage({message:c.message});
  const first=await service.publish({challengeId:c.id,signature});
  assert.equal(first.review.rating,4); assert.equal(first.review.chainId,97); assert.equal(first.replayed,false);
  assert.equal((await service.publish({challengeId:c.id,signature})).replayed,true);
  assert.equal(first.review.signature,undefined);
});
for(const [name,patch] of [['unfinished',{status:2}],['rejected',{status:4}],['wrong buyer',{client:other.address}],['wrong provider',{provider:other.address}],['wrong router',{evaluator:other.address}],['wrong hook',{hook:other.address}],['wrong job',{id:1180n}]]) test(`rejects ${name}`,async()=>{const {service,job}=setup(); Object.assign(job,patch); await assert.rejects(()=>service.challenge(input));});
for(const patch of [{rating:0},{rating:1.1},{rating:6},{comment:'x'.repeat(1001)},{comment:'bad\u0000'},{subject:'erc8004:97:1'},{jobId:'01'},{buyer:'nope'},{chainId:56}]) test(`rejects invalid input ${JSON.stringify(patch).slice(0,70)}`,async()=>{await assert.rejects(()=>setup().service.challenge({...input,...patch}));});
test('rejects wrong signer and tampered signed content',async()=>{const {service}=setup(); const c=await service.challenge(input); for(const signature of [await other.signMessage({message:c.message}),await account.signMessage({message:c.message.replace('Rating: 4/5','Rating: 5/5')}),await account.signMessage({message:c.message.replace('Useful <b>plain text</b>','Different feedback')})]) await assert.rejects(()=>service.publish({challengeId:c.id,signature}),/signature|buyer/i);});
test('expired nonce cannot publish',async()=>{const {service,advance}=setup();const c=await service.challenge(input);const signature=await account.signMessage({message:c.message});advance();await assert.rejects(()=>service.publish({challengeId:c.id,signature}),/expired/i);});
test('publication rechecks on-chain job',async()=>{const {service,job}=setup();const c=await service.challenge(input);job.status=2;const signature=await account.signMessage({message:c.message});await assert.rejects(()=>service.publish({challengeId:c.id,signature}));});
test('RPC and storage failure cannot publish',async()=>{await assert.rejects(()=>setup({readJob:async()=>{throw Error('RPC down');}}).service.challenge(input));const {service,store}=setup();const c=await service.challenge(input);store.publish=async()=>{throw Error('storage down');};const signature=await account.signMessage({message:c.message});await assert.rejects(()=>service.publish({challengeId:c.id,signature}),/storage/);});
test('signed retries succeed after nonce expiry but a different signed review conflicts',async()=>{const {service,advance}=setup();const a=await service.challenge(input);const b=await service.challenge({...input,rating:5});const signature=await account.signMessage({message:a.message});await service.publish({challengeId:a.id,signature});advance();assert.equal((await service.publish({challengeId:a.id,signature})).replayed,true);const otherSignature=await account.signMessage({message:b.message});await assert.rejects(()=>service.publish({challengeId:b.id,signature:otherSignature}),/different review/);});
