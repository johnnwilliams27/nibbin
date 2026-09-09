import { createPool,PostgresStore } from '../lib/postgres.mjs';
import { decimal } from '../lib/protocol.mjs';
const [id,reason,operator]=process.argv.slice(2);decimal(id,'review ID');
const pool=createPool(process.env.DATABASE_URL);
try{await new PostgresStore(pool).hide(id,reason,operator);console.log('Review hidden; audit entry saved.');}catch{console.error('Review removal failed. Supply review ID, reason, operator and database access.');process.exitCode=1;}finally{await pool.end();}
