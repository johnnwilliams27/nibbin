## C:\Nibbin\.worktrees\trust-index-handoff\trust-index\apps\buyer-reviews\lib\chain.mjs

import { createPublicClient, http, parseAbi } from 'viem';
import { bscTestnet } from 'viem/chains';
import { COMMERCE,requireThat } from './protocol.mjs';
const abi=parseAbi(['function getJob(uint256 jobId) view returns ((uint256 id,address client,address provider,address evaluator,string description,uint256 budget,uint256 expiredAt,uint8 status,address hook,uint256 submittedAt,bytes32 deliverable))']);
// Fixed destination: neither requests nor arbitrary environment values can route RPC traffic.
export function createJobReader(client=createPublicClient({chain:bscTestnet,transport:http('https://data-seed-prebsc-1-s1.bnbchain.org:8545',{timeout:8000,retryCount:0})})) {
 return async jobId=>{
  requireThat(await client.getChainId()===97,'RPC chain mismatch',503);
  const block=await client.getBlock({blockTag:'finalized'});requireThat(block.number!==null&&block.hash,'Finalized block unavailable',503);
  const job=await client.readContract({address:COMMERCE,abi,functionName:'getJob',args:[BigInt(jobId)],blockNumber:block.number});
  const checked=await client.getBlock({blockNumber:block.number});requireThat(checked.hash===block.hash,'Chain evidence changed',503);
  return {job,blockNumber:String(block.number),blockHash:block.hash};
 };
}


## C:\Nibbin\.worktrees\trust-index-handoff\trust-index\apps\buyer-reviews\lib\postgres.mjs

import pg from 'pg';
import { SUBJECT,requireThat,publicReview } from './protocol.mjs';
export function createPool(connectionString) {requireThat(connectionString,'Review database unavailable',503);return new pg.Pool({connectionString,max:3,connectionTimeoutMillis:5000,idleTimeoutMillis:10000,statement_timeout:8000,query_timeout:9000});}
function row(r) {if(!r)return undefined;return {id:String(r.id),subject:r.subject,chainId:r.chain_id,commerce:r.commerce,jobId:String(r.job_id),buyer:r.buyer,rating:r.rating,comment:r.comment,message:r.message,signature:r.signature,createdAt:new Date(r.created_at).toISOString()};}
export class PostgresStore {
 constructor(pool) {this.pool=pool;}
 async putChallenge(c) {await this.pool.query('INSERT INTO review_challenges(id,payload,expires_at) VALUES($1,$2,to_timestamp($3))',[c.id,c,c.expiresAt]);}
 async getChallenge(id) {return (await this.pool.query('SELECT payload FROM review_challenges WHERE id=$1',[id])).rows[0]?.payload;}
 async findReview(c) {return row((await this.pool.query('SELECT * FROM buyer_reviews WHERE chain_id=$1 AND commerce=$2 AND job_id=$3',[c.chainId,c.commerce,c.jobId])).rows[0]);}
 async publish(c,signature,v) {
  const db=await this.pool.connect();try {
   await db.query('BEGIN');
   const locked=(await db.query('SELECT payload,consumed_at,expires_at > now() AS live FROM review_challenges WHERE id=$1 FOR UPDATE',[c.id])).rows[0];
   requireThat(locked&&locked.payload.message===c.message,'Challenge does not match',403);
   // A transaction-scoped advisory lock serializes different nonces for the same unique job.
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${c.chainId}:${c.commerce}:${c.jobId}`]);
   const existing=row((await db.query('SELECT * FROM buyer_reviews WHERE chain_id=$1 AND commerce=$2 AND job_id=$3',[c.chainId,c.commerce,c.jobId])).rows[0]);
   if(existing){requireThat(existing.message===c.message&&existing.signature===signature,'This job already has a different review',409);await db.query('COMMIT');return {review:existing,replayed:true};}
   requireThat(locked.live&&!locked.consumed_at,'Challenge expired or consumed',403);
   const inserted=await db.query('INSERT INTO buyer_reviews(subject,chain_id,commerce,job_id,buyer,rating,comment,message,signature,challenge_id,verification_block,verification_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *',[c.subject,c.chainId,c.commerce,c.jobId,c.buyer,c.rating,c.comment,c.message,signature,c.id,v.blockNumber,v.blockHash]);
   await db.query('UPDATE review_challenges SET consumed_at=now() WHERE id=$1',[c.id]);await db.query('COMMIT');return {review:row(inserted.rows[0]),replayed:false};
  } catch(error) {await db.query('ROLLBACK');throw error;} finally {db.release();}
 }
 async list(subject,cursor) {
  const result=await this.pool.query('SELECT * FROM buyer_reviews WHERE subject=$1 AND hidden_at IS NULL AND ($2::bigint IS NULL OR id<$2) ORDER BY id DESC LIMIT 21',[subject,cursor??null]);
  return {reviews:result.rows.slice(0,20).map(r=>publicReview(row(r))),nextCursor:result.rows.length>20?String(result.rows[19].id):null};
 }
 async summaries(subjects) {
  const {rows}=await this.pool.query('SELECT subject,chain_id,count(*)::integer AS count,avg(rating)::float AS average,count(DISTINCT buyer)::integer AS unique_buyers FROM buyer_reviews WHERE subject=ANY($1::text[]) AND hidden_at IS NULL GROUP BY subject,chain_id',[subjects]);
  return subjects.map(subject=>{const summary={subject,enabled:subject===SUBJECT,mainnet:{count:0,average:null,uniqueBuyers:0},testnet:{count:0,average:null,uniqueBuyers:0}};for(const r of rows.filter(r=>r.subject===subject))summary[r.chain_id===56?'mainnet':'testnet']={count:r.count,average:r.average,uniqueBuyers:r.unique_buyers};return summary;});
 }
 async rateLimit(key,limit) {
  // All clients share durable buckets across instances; maintenance also bounds expired storage.
  await this.pool.query('DELETE FROM review_rate_buckets WHERE bucket < floor(extract(epoch from now())/60)-2');
  const {rows}=await this.pool.query('INSERT INTO review_rate_buckets(key,bucket,count) VALUES($1,floor(extract(epoch from now())/60),1) ON CONFLICT(key,bucket) DO UPDATE SET count=LEAST(review_rate_buckets.count+1,$2+1) RETURNING count',[key,limit]);return rows[0].count<=limit;
 }
 async hide(id,reason,operator) {
  requireThat(typeof reason==='string'&&reason.trim().length>0&&reason.length<=1000,'Provide an audit reason');requireThat(typeof operator==='string'&&operator.trim().length>0&&operator.length<=200,'Provide an operator identity');
  const db=await this.pool.connect();try{await db.query('BEGIN');const result=await db.query('UPDATE buyer_reviews SET hidden_at=now() WHERE id=$1 RETURNING id',[id]);requireThat(result.rowCount===1,'Review not found',400);await db.query('INSERT INTO review_moderation(review_id,reason,operator) VALUES($1,$2,$3)',[id,reason,operator]);await db.query('COMMIT');}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
 }
 async cleanup() {await this.pool.query('DELETE FROM review_challenges WHERE expires_at < now()-interval \'1 day\' AND consumed_at IS NULL');await this.pool.query('DELETE FROM review_rate_buckets WHERE bucket < floor(extract(epoch from now())/60)-2');}
}


## C:\Nibbin\.worktrees\trust-index-handoff\trust-index\apps\buyer-reviews\lib\protocol.mjs

import { isAddress } from 'viem';
export const SUBJECT = 'reference:97:health-factor';
export const COMMERCE = '0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de';
export const ROUTER = '0xd7d36d66d2f1b608a0f943f722d27e3744f66f25';
export const PROVIDER = '0x6f736f824b27f686e6cc5dbd945f9727812a1c72';
export class ReviewError extends Error { constructor(status,message) {super(message);this.status=status;} }
export function requireThat(value,message,status=400) {if(!value) throw new ReviewError(status,message);}
export function strictObject(value,keys) {requireThat(value && typeof value==='object' && !Array.isArray(value),'Expected an object');requireThat(Object.keys(value).every(k=>keys.includes(k)),'Unexpected request field');}
export function decimal(value,name='job ID') {requireThat(typeof value==='string' && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value)<2n**256n,`Invalid ${name}`);return value;}
export function subject(value) {requireThat(typeof value==='string' && value.length<=120 && (value===SUBJECT || /^erc8004:[1-9][0-9]{0,9}:(0|[1-9][0-9]{0,77})$/.test(value)),'Invalid subject');return value;}
export function parseReview(value) {
 strictObject(value,['subject','jobId','buyer','rating','comment']);subject(value.subject);requireThat(value.subject===SUBJECT,'Reviews are not enabled for this subject',403);
 decimal(value.jobId);requireThat(typeof value.buyer==='string' && isAddress(value.buyer,{strict:false}) && !/^0x0{40}$/i.test(value.buyer),'Invalid buyer');
 requireThat(Number.isInteger(value.rating)&&value.rating>=1&&value.rating<=5,'Rating must be an integer from 1 to 5');
 const comment=value.comment??'';requireThat(typeof comment==='string'&&comment.length<=1000&&!/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(comment),'Comment must be plain text up to 1,000 characters without control characters');
 return {...value,buyer:value.buyer.toLowerCase(),comment,chainId:97,commerce:COMMERCE};
}
export function reviewMessage(c,audience) {return ['Nibbin buyer review v1',`Audience: ${audience}`,`Subject: ${c.subject}`,'Chain: 97',`Commerce: ${COMMERCE}`,`Job: ${c.jobId}`,`Buyer: ${c.buyer}`,`Rating: ${c.rating}/5`,`Comment: ${JSON.stringify(c.comment)}`,`Nonce: ${c.nonce}`,`Issued at: ${c.issuedAt}`,`Expires at: ${c.expiresAt}`,'Public review. No transaction or spending approval.'].join('\n');}
export function publicReview(r) {return {id:String(r.id),subject:r.subject,chainId:r.chainId,jobId:r.jobId,buyer:r.buyer,rating:r.rating,comment:r.comment,createdAt:r.createdAt};}


## C:\Nibbin\.worktrees\trust-index-handoff\trust-index\apps\buyer-reviews\lib\service.mjs

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


## C:\Nibbin\.worktrees\trust-index-handoff\trust-index\apps\buyer-reviews\api\reviews.mjs

import { createHash } from 'node:crypto';
import { createService } from '../lib/service.mjs';
import { createPool,PostgresStore } from '../lib/postgres.mjs';
import { createJobReader } from '../lib/chain.mjs';
import { ReviewError,requireThat,subject,decimal } from '../lib/protocol.mjs';
export const config={api:{bodyParser:false}};
const MAX_BODY=16384;
async function body(req) {
 requireThat(/^application\/json(?:;|$)/i.test(req.headers['content-type']??''),'Use application/json');
 requireThat(!req.headers['content-length']||Number(req.headers['content-length'])<=MAX_BODY,'Request too large');
 const chunks=[];let size=0;
 for await(const chunk of req){size+=chunk.length;requireThat(size<=MAX_BODY,'Request too large');chunks.push(chunk);}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new ReviewError(400,'Invalid JSON');}
}
export function createHandler({env=process.env,service,store}={}) {
 return async(req,res)=>{
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Vary','Origin');
  try {
   const origins=(env.REVIEWS_ALLOWED_ORIGINS??'').split(',').map(s=>s.trim()).filter(Boolean);
   const origin=req.headers.origin;if(origin){requireThat(origins.includes(origin),'Origin is not allowed',403);res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');}
   if(req.method==='OPTIONS'){res.statusCode=204;res.end();return;}
   requireThat(['GET','POST'].includes(req.method),'Method not supported',400);
   if(!store){requireThat(env.DATABASE_URL&&env.REVIEWS_API_ORIGIN,'Review service unavailable',503);store=new PostgresStore(createPool(env.DATABASE_URL));service=createService({store,readJob:createJobReader(),audience:env.REVIEWS_API_ORIGIN});}
   // Only trust Vercel's platform-overwritten IP header in production, never client x-forwarded-for.
   const ip=env.VERCEL==='1'?String(req.headers['x-vercel-forwarded-for']??'unknown').split(',')[0]:req.socket.remoteAddress??'unknown';
   const key=createHash('sha256').update(ip).digest('hex');
   requireThat(await store.rateLimit('global',600),'Review service rate limit reached',429);
   requireThat(await store.rateLimit(`${req.method}:${key}`,req.method==='POST'?20:120),'Too many requests',429);
   let result;
   if(req.method==='POST'){
    const payload=await body(req);requireThat(payload&&typeof payload==='object'&&!Array.isArray(payload),'Expected an object');
    const {action,...input}=payload;
    if(action==='challenge'){requireThat(await store.rateLimit(`challenge:${key}`,10),'Too many challenges',429);result=await service.challenge(input);}
    else if(action==='publish')result=await service.publish(input);
    else throw new ReviewError(400,'Unknown action');
   }else{
    const query=new URL(req.url,'https://reviews.invalid').searchParams;
    requireThat([...query.keys()].every(k=>['subjects','subject','cursor'].includes(k)),'Unknown query parameter');
    requireThat([...new Set(query.keys())].every(k=>query.getAll(k).length===1),'Duplicate query parameter');
    if(query.has('subjects')){requireThat(!query.has('subject')&&!query.has('cursor'),'Choose one query');const subjects=query.get('subjects').split(',');requireThat(subjects.length>=1&&subjects.length<=24,'Request at most 24 subjects');subjects.forEach(subject);result={summaries:await store.summaries([...new Set(subjects)])};}
    else{const value=subject(query.get('subject'));const cursor=query.get('cursor');if(cursor!==null){decimal(cursor,'cursor');requireThat(BigInt(cursor)<=9223372036854775807n,'Invalid cursor');}result=await store.list(value,cursor??undefined);}
   }
   res.statusCode=200;res.end(JSON.stringify(result));
  }catch(error){res.statusCode=error instanceof ReviewError?error.status:503;if(res.statusCode===429)res.setHeader('Retry-After','60');res.end(JSON.stringify({error:error instanceof ReviewError?error.message:'Review service temporarily unavailable'}));}
 };
}
export default createHandler();


## C:\Nibbin\.worktrees\trust-index-handoff\trust-index\apps\buyer-reviews\tests\chain.test.mjs

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


## C:\Nibbin\.worktrees\trust-index-handoff\trust-index\apps\buyer-reviews\tests\http.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHandler } from '../api/reviews.mjs';
async function request(t, handler, init={},query='') {const server=createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());return fetch(`http://127.0.0.1:${server.address().port}/api/reviews${query}`,init);}
test('unconfigured durable service is unavailable, never an empty success',async t=>{const r=await request(t,createHandler({env:{}}));assert.equal(r.status,503);});
test('disallowed origins fail before service access',async t=>{const r=await request(t,createHandler({env:{REVIEWS_ALLOWED_ORIGINS:'https://market.example'}}),{headers:{origin:'https://evil.example'}});assert.equal(r.status,403);});
test('oversized body is rejected',async t=>{const r=await request(t,createHandler({env:{},service:{},store:{rateLimit:async()=>true}}),{method:'POST',headers:{'content-type':'application/json'},body:' '.repeat(17000)});assert.equal(r.status,400);});
test('summary page is bounded',async t=>{const r=await request(t,createHandler({env:{},service:{},store:{rateLimit:async()=>true}}),{},'?subjects='+Array.from({length:25},(_,i)=>`erc8004:97:${i}`).join(','));assert.equal(r.status,400);});


## C:\Nibbin\.worktrees\trust-index-handoff\trust-index\apps\buyer-reviews\tests\postgres.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgresStore } from '../lib/postgres.mjs';
test('isolated PostgreSQL: concurrent inserts, replay, conflict, paging, network summaries and audited hiding',{skip:!process.env.REVIEWS_TEST_DATABASE_URL},async()=>{
 const schema=`reviews_test_${randomUUID().replaceAll('-','')}`;const admin=new pg.Pool({connectionString:process.env.REVIEWS_TEST_DATABASE_URL});await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.REVIEWS_TEST_DATABASE_URL,options:`-c search_path=${schema}`});
 try {await pool.query(await readFile(new URL('../migrations/001_reviews.sql',import.meta.url),'utf8'));const store=new PostgresStore(pool);
 const base={id:randomUUID(),nonce:'ab'.repeat(32),subject:'reference:97:health-factor',chainId:97,commerce:'0x'+'aa'.repeat(20),jobId:'1',buyer:'0x'+'bb'.repeat(20),rating:4,comment:'Good',issuedAt:Math.floor(Date.now()/1000),expiresAt:Math.floor(Date.now()/1000)+600,message:'signed message'};
 await store.putChallenge(base);const verification={blockNumber:'123',blockHash:'0x'+'cd'.repeat(32)};
 const results=await Promise.all([store.publish(base,'0x11',verification),store.publish(base,'0x11',verification)]);assert.equal(results[0].review.id,results[1].review.id);assert.equal(results.filter(x=>!x.replayed).length,1);
 const changed={...base,id:randomUUID(),rating:5,message:'changed'};await store.putChallenge(changed);await assert.rejects(()=>store.publish(changed,'0x22',verification),/already|conflict/i);
 for(let i=2;i<=22;i++){const c={...base,id:randomUUID(),jobId:String(i)};await store.putChallenge(c);await store.publish(c,'0x11',verification);}
 const main={...base,id:randomUUID(),chainId:56,jobId:'23',rating:1};await store.putChallenge(main);await store.publish(main,'0x11',verification);
 const summaries=await store.summaries([base.subject]);assert.equal(summaries[0].testnet.count,22);assert.equal(summaries[0].mainnet.count,1);assert.equal(summaries[0].mainnet.average,1);
 const page=await store.list(base.subject);assert.equal(page.reviews.length,20);const next=await store.list(base.subject,page.nextCursor);assert.equal(next.reviews.length,3);assert.ok(!next.reviews.some(r=>page.reviews.some(p=>p.id===r.id)));
 await store.hide(results[0].review.id,'abusive content','test operator');assert.equal((await store.summaries([base.subject]))[0].testnet.count,21);assert.equal((await pool.query('SELECT * FROM review_moderation')).rowCount,1);
 assert.equal(await store.rateLimit('test',2),true);assert.equal(await store.rateLimit('test',2),true);assert.equal(await store.rateLimit('test',2),false);
 } finally {await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});


## C:\Nibbin\.worktrees\trust-index-handoff\trust-index\apps\buyer-reviews\tests\service.test.mjs

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
test('rejects wrong signer and tampered signed content',async()=>{const {service}=setup(); const c=await service.challenge(input); for(const signature of [await other.signMessage({message:c.message}),await account.signMessage({message:c.message.replace('Rating: 4/5','Rating: 5/5')})]) await assert.rejects(()=>service.publish({challengeId:c.id,signature}),/signature|buyer/i);});
test('expired nonce cannot publish',async()=>{const {service,advance}=setup();const c=await service.challenge(input);const signature=await account.signMessage({message:c.message});advance();await assert.rejects(()=>service.publish({challengeId:c.id,signature}),/expired/i);});
test('publication rechecks on-chain job',async()=>{const {service,job}=setup();const c=await service.challenge(input);job.status=2;const signature=await account.signMessage({message:c.message});await assert.rejects(()=>service.publish({challengeId:c.id,signature}));});
test('RPC and storage failure cannot publish',async()=>{await assert.rejects(()=>setup({readJob:async()=>{throw Error('RPC down');}}).service.challenge(input));const {service,store}=setup();const c=await service.challenge(input);store.publish=async()=>{throw Error('storage down');};const signature=await account.signMessage({message:c.message});await assert.rejects(()=>service.publish({challengeId:c.id,signature}),/storage/);});


## C:\Nibbin\.worktrees\trust-index-handoff\trust-index\apps\buyer-reviews\migrations\001_reviews.sql

BEGIN;
CREATE TABLE IF NOT EXISTS review_challenges (
 id uuid PRIMARY KEY, payload jsonb NOT NULL, expires_at timestamptz NOT NULL,
 consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS review_challenges_expiry ON review_challenges(expires_at);
CREATE TABLE IF NOT EXISTS buyer_reviews (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 subject text NOT NULL, chain_id integer NOT NULL CHECK(chain_id IN (56,97)),
 commerce text NOT NULL, job_id numeric(78,0) NOT NULL,
 buyer text NOT NULL, rating integer NOT NULL CHECK(rating BETWEEN 1 AND 5),
 comment text NOT NULL CHECK(length(comment)<=1000), message text NOT NULL, signature text NOT NULL,
 challenge_id uuid NOT NULL REFERENCES review_challenges(id),
 verification_block numeric(78,0) NOT NULL, verification_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), hidden_at timestamptz,
 UNIQUE(chain_id,commerce,job_id)
);
CREATE INDEX IF NOT EXISTS buyer_reviews_public_subject ON buyer_reviews(subject,id DESC) WHERE hidden_at IS NULL;
CREATE TABLE IF NOT EXISTS review_moderation (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, review_id bigint NOT NULL REFERENCES buyer_reviews(id),
 reason text NOT NULL, operator text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS review_rate_buckets (
 key text NOT NULL, bucket bigint NOT NULL, count integer NOT NULL, PRIMARY KEY(key,bucket)
);
CREATE INDEX IF NOT EXISTS review_rate_expiry ON review_rate_buckets(bucket);
COMMIT;


## C:\Nibbin\.worktrees\trust-index-handoff\trust-index\apps\buyer-reviews\scripts\cleanup.mjs

import { createPool,PostgresStore } from '../lib/postgres.mjs';
const pool=createPool(process.env.DATABASE_URL);
try{await new PostgresStore(pool).cleanup();console.log('Expired unused challenges and rate buckets removed.');}catch{console.error('Review cleanup failed.');process.exitCode=1;}finally{await pool.end();}


## C:\Nibbin\.worktrees\trust-index-handoff\trust-index\apps\buyer-reviews\scripts\dev.mjs

import { createServer } from 'node:http';
import handler from '../api/reviews.mjs';
const port=Number(process.env.PORT??3101);
createServer((req,res)=>{if(new URL(req.url,'http://localhost').pathname!=='/api/reviews'){res.writeHead(404).end();return;}return handler(req,res);}).listen(port,'127.0.0.1',()=>console.log(`Review API: http://localhost:${port}/api/reviews`));


## C:\Nibbin\.worktrees\trust-index-handoff\trust-index\apps\buyer-reviews\scripts\hide.mjs

import { createPool,PostgresStore } from '../lib/postgres.mjs';
import { decimal } from '../lib/protocol.mjs';
const [id,reason,operator]=process.argv.slice(2);decimal(id,'review ID');
const pool=createPool(process.env.DATABASE_URL);
try{await new PostgresStore(pool).hide(id,reason,operator);console.log('Review hidden; audit entry saved.');}catch{console.error('Review removal failed. Supply review ID, reason, operator and database access.');process.exitCode=1;}finally{await pool.end();}


## C:\Nibbin\.worktrees\trust-index-handoff\trust-index\apps\buyer-reviews\scripts\migrate.mjs

import { readFile } from 'node:fs/promises';
import { createPool } from '../lib/postgres.mjs';
const pool=createPool(process.env.DATABASE_URL);
try{await pool.query(await readFile(new URL('../migrations/001_reviews.sql',import.meta.url),'utf8'));console.log('Review schema ready.');}catch{console.error('Review migration failed. Check database access and schema permissions.');process.exitCode=1;}finally{await pool.end();}

