import { createPool,PostgresStore } from '../lib/postgres.mjs';
const pool=createPool(process.env.DATABASE_URL);
try{await new PostgresStore(pool).cleanup();console.log('Expired unused challenges and rate buckets removed.');}catch{console.error('Review cleanup failed.');process.exitCode=1;}finally{await pool.end();}
