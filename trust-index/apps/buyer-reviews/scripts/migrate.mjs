import { readFile } from 'node:fs/promises';
import { createPool } from '../lib/postgres.mjs';
const pool=createPool(process.env.DATABASE_URL);
try{await pool.query(await readFile(new URL('../migrations/001_reviews.sql',import.meta.url),'utf8'));console.log('Review schema ready.');}catch{console.error('Review migration failed. Check database access and schema permissions.');process.exitCode=1;}finally{await pool.end();}
