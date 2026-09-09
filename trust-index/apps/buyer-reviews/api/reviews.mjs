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
 if(req.body!==undefined){
  const encoded=Buffer.isBuffer(req.body)?req.body.toString('utf8'):typeof req.body==='string'?req.body:JSON.stringify(req.body);
  requireThat(typeof encoded==='string'&&Buffer.byteLength(encoded)<=MAX_BODY,'Request too large');
  try{return JSON.parse(encoded);}catch{throw new ReviewError(400,'Invalid JSON');}
 }
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
   if(!store){requireThat(env.DATABASE_URL&&env.REVIEWS_API_ORIGIN,'Review service unavailable',503);const candidateStore=new PostgresStore(createPool(env.DATABASE_URL));const candidateService=createService({store:candidateStore,readJob:createJobReader(),audience:env.REVIEWS_API_ORIGIN.trim()});store=candidateStore;service=candidateService;}
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
