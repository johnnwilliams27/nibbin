import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHandler } from '../api/reviews.mjs';
async function request(t, handler, init={},query='') {const server=createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());return fetch(`http://127.0.0.1:${server.address().port}/api/reviews${query}`,init);}
test('unconfigured durable service is unavailable, never an empty success',async t=>{const r=await request(t,createHandler({env:{}}));assert.equal(r.status,503);});
test('disallowed origins fail before service access',async t=>{const r=await request(t,createHandler({env:{REVIEWS_ALLOWED_ORIGINS:'https://market.example'}}),{headers:{origin:'https://evil.example'}});assert.equal(r.status,403);});
test('oversized body is rejected',async t=>{const r=await request(t,createHandler({env:{},service:{},store:{rateLimit:async()=>true}}),{method:'POST',headers:{'content-type':'application/json'},body:' '.repeat(17000)});assert.equal(r.status,400);});
test('summary page is bounded',async t=>{const r=await request(t,createHandler({env:{},service:{},store:{rateLimit:async()=>true}}),{},'?subjects='+Array.from({length:25},(_,i)=>`erc8004:97:${i}`).join(','));assert.equal(r.status,400);});
test('rate-limit denial returns 429 before expensive service work',async t=>{const r=await request(t,createHandler({env:{},service:{},store:{rateLimit:async()=>false}}));assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'60');});
test('database details are not reflected in public errors',async t=>{const r=await request(t,createHandler({env:{},service:{},store:{rateLimit:async()=>{throw Error('postgres://secret-password');}}}));assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'Review service temporarily unavailable'});});
test('Vercel parsed body preserves challenge HTTP contract',async t=>{const handler=createHandler({env:{},service:{challenge:async input=>({id:'challenge',rating:input.rating})},store:{rateLimit:async()=>true}});const r=await request(t,(req,res)=>{req.body={action:'challenge',rating:4};return handler(req,res);},{method:'POST',headers:{'content-type':'application/json'}});assert.equal(r.status,200);assert.deepEqual(await r.json(),{id:'challenge',rating:4});});
