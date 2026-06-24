/**
 * Bootstrap the `brain-sources` Storage bucket.
 *
 * Run once per environment before the upload route goes live:
 *
 *   SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> npx tsx scripts/bootstrap-brain-sources-bucket.ts
 *
 * The bucket is private (not public) with a 20 MB per-file size limit.
 * Path convention: {account_id}/{source_id}/{sanitized-filename}
 * RLS is enforced at the application layer (service-role upload; presigned
 * URLs never generated for cross-account reads; per-account path prefix is the
 * isolation unit).
 *
 * Idempotent: running against an environment where the bucket already exists
 * prints "already exists" and exits 0.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const BUCKET = 'brain-sources';
const FILE_SIZE_LIMIT = 20 * 1024 * 1024; // 20 MB

const { data, error } = await supabase.storage.createBucket(BUCKET, {
  public: false,
  fileSizeLimit: FILE_SIZE_LIMIT,
});

if (error) {
  if (
    error.message.toLowerCase().includes('already exists') ||
    error.message.toLowerCase().includes('duplicate')
  ) {
    console.log(`[brain-sources] bucket already exists — skipping`);
    process.exit(0);
  }
  console.error(`[brain-sources] ERROR creating bucket: ${error.message}`);
  process.exit(1);
}

console.log(`[brain-sources] bucket created successfully:`, data);
