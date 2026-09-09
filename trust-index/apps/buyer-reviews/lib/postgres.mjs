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
