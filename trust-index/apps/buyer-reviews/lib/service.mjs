import { randomBytes, randomUUID } from 'node:crypto';
import { verifyMessage } from 'viem';
import { PROVIDER,ROUTER,ReviewError,requireThat,strictObject,parseReview,reviewMessage,publicReview } from './protocol.mjs';
export function createService({store,readJob,audience,now=()=>Math.floor(Date.now()/1000)}) {
 requireThat(typeof audience==='string'&&new URL(audience).origin===audience,'Configure a canonical API origin',503);
 async function verifyJob(c) {
  const result=await readJob(c.jobId);const j=result?.job;
  requireThat(j&&String(j.id)===c.jobId,'Job identity does not match',403);
  requireThat(Number(j.status)===3,'Job must be Completed',403);
  requireThat(j.client?.toLowerCase()===c.buyer,'Job buyer does not match',403);
  requireThat(j.provider?.toLowerCase()===PROVIDER,'Job provider does not match',403);
  requireThat(j.evaluator?.toLowerCase()===ROUTER&&j.hook?.toLowerCase()===ROUTER,'Unsupported job router or hook',403);
  requireThat(/^[0-9]+$/.test(String(result.blockNumber))&&/^0x[0-9a-f]{64}$/i.test(result.blockHash),'Confirmed chain evidence unavailable',503);
  return {blockNumber:String(result.blockNumber),blockHash:result.blockHash};
 }
 return {
  async challenge(input) {
   const value=parseReview(input);await verifyJob(value);
   requireThat(!await store.findReview(value),'This job already has a review',409);
   const issuedAt=now();const c={...value,id:randomUUID(),nonce:randomBytes(32).toString('hex'),issuedAt,expiresAt:issuedAt+600};c.message=reviewMessage(c,audience);await store.putChallenge(c);
   return {id:c.id,nonce:c.nonce,issuedAt:c.issuedAt,expiresAt:c.expiresAt,message:c.message};
  },
  async publish(input) {
   strictObject(input,['challengeId','signature']);requireThat(typeof input.challengeId==='string'&&/^[0-9a-f-]{36}$/.test(input.challengeId),'Invalid challenge ID');requireThat(typeof input.signature==='string'&&/^0x[0-9a-f]{130}$/i.test(input.signature),'Invalid signature');
   const c=await store.getChallenge(input.challengeId);requireThat(c,'Challenge not found',403);
   requireThat(c.message===reviewMessage(c,audience),'Challenge audience or content changed',403);
   let valid=false;try{valid=await verifyMessage({address:c.buyer,message:c.message,signature:input.signature});}catch{}
   requireThat(valid,'Signature does not match buyer',403);
   const existing=await store.findReview(c);
   if(existing) {requireThat(existing.message===c.message&&existing.signature===input.signature,'This job already has a different review',409);return {review:publicReview(existing),replayed:true};}
   requireThat(c.expiresAt>now()&&c.issuedAt<=now(),'Challenge expired',403);
   const verification=await verifyJob(c);const result=await store.publish(c,input.signature,verification);
   return {...result,review:publicReview(result.review)};
  },
 };
}
