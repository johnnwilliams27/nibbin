import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { PostgresStore } from '../lib/postgres.mjs';
import { createService } from '../lib/service.mjs';
import { privateKeyToAccount } from 'viem/accounts';
import { PROVIDER,ROUTER } from '../lib/protocol.mjs';
test('isolated PostgreSQL: concurrent inserts, replay, conflict, paging, network summaries and audited hiding',{skip:!process.env.REVIEWS_TEST_DATABASE_URL},async()=>{
 const schema=`reviews_test_${randomUUID().replaceAll('-','')}`;const admin=new pg.Pool({connectionString:process.env.REVIEWS_TEST_DATABASE_URL});await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new pg.Pool({connectionString:process.env.REVIEWS_TEST_DATABASE_URL,options:`-c search_path=${schema}`});
 try {await pool.query(await readFile(new URL('../migrations/001_reviews.sql',import.meta.url),'utf8'));const store=new PostgresStore(pool);
 const base={id:randomUUID(),nonce:'ab'.repeat(32),subject:'reference:97:health-factor',chainId:97,commerce:'0x'+'aa'.repeat(20),jobId:'1',buyer:'0x'+'bb'.repeat(20),rating:4,comment:'Good',issuedAt:Math.floor(Date.now()/1000),expiresAt:Math.floor(Date.now()/1000)+600,message:'signed message'};
 await store.putChallenge(base);const verification={blockNumber:'123',blockHash:'0x'+'cd'.repeat(32)};
 const results=await Promise.all([store.publish(base,'0x11',verification),store.publish(base,'0x11',verification)]);assert.equal(results[0].review.id,results[1].review.id);assert.equal(results.filter(x=>!x.replayed).length,1);
 const account=privateKeyToAccount(`0x${'11'.repeat(32)}`);const service=createService({store,audience:'https://reviews.example',readJob:async()=>({...verification,job:{id:999n,client:account.address,provider:PROVIDER,evaluator:ROUTER,hook:ROUTER,status:3}})});
 const raceInput={subject:base.subject,jobId:'999',buyer:account.address,rating:4,comment:'Concurrent signed review'};
 const raceA=await service.challenge(raceInput);const raceB=await service.challenge({...raceInput,rating:5});
 const signatureA=await account.signMessage({message:raceA.message});const signatureB=await account.signMessage({message:raceB.message});
 const raced=await Promise.allSettled([service.publish({challengeId:raceA.id,signature:signatureA}),service.publish({challengeId:raceB.id,signature:signatureB})]);assert.equal(raced.filter(r=>r.status==='fulfilled').length,1);const conflict=raced.find(r=>r.status==='rejected');assert.equal(conflict.reason.status,409);assert.equal((await pool.query('SELECT * FROM buyer_reviews WHERE job_id=999')).rowCount,1);
 await store.hide(raced.find(r=>r.status==='fulfilled').value.review.id,'hide race fixture','test operator');
 const changed={...base,id:randomUUID(),rating:5,message:'changed'};await store.putChallenge(changed);await assert.rejects(()=>store.publish(changed,'0x22',verification),/already|conflict/i);
 for(let i=2;i<=22;i++){const c={...base,id:randomUUID(),jobId:String(i)};await store.putChallenge(c);await store.publish(c,'0x11',verification);}
 const main={...base,id:randomUUID(),chainId:56,jobId:'23',rating:1};await store.putChallenge(main);await store.publish(main,'0x11',verification);
 const summaries=await store.summaries([base.subject]);assert.equal(summaries[0].testnet.count,22);assert.equal(summaries[0].mainnet.count,1);assert.equal(summaries[0].mainnet.average,1);
 const page=await store.list(base.subject);assert.equal(page.reviews.length,20);const next=await store.list(base.subject,page.nextCursor);assert.equal(next.reviews.length,3);assert.ok(!next.reviews.some(r=>page.reviews.some(p=>p.id===r.id)));
 await store.hide(results[0].review.id,'abusive content','test operator');assert.equal((await store.summaries([base.subject]))[0].testnet.count,21);assert.equal((await pool.query('SELECT * FROM review_moderation')).rowCount,2);
 assert.equal(await store.rateLimit('test',2),true);assert.equal(await store.rateLimit('test',2),true);assert.equal(await store.rateLimit('test',2),false);
 } finally {await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
