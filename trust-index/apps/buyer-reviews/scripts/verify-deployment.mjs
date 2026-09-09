import { spawnSync } from 'node:child_process';
// Deployment operator authorizes this build only against the dedicated review DB.
// Connection strings stay in child environment, never arguments or logs.
if(!process.env.DATABASE_URL?.trim()){console.error('Dedicated review database is required for deployment verification.');process.exit(1);}
for(const args of [['scripts/migrate.mjs'],['--test','tests/postgres.test.mjs']]){
 const result=spawnSync(process.execPath,args,{stdio:'inherit',env:{...process.env,REVIEWS_TEST_DATABASE_URL:(process.env.DATABASE_URL_UNPOOLED??process.env.DATABASE_URL).trim()}});
 if(result.status!==0){console.error('Review deployment verification failed.');process.exit(1);}
}
