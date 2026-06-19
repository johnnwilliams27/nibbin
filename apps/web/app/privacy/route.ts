import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Read at module load time so the file is captured by Next's output-file
// tracing and shipped into the Vercel function bundle. The monorepo root is
// two directories above apps/web, matching outputFileTracingRoot in next.config.mjs.
const html = readFileSync(join(process.cwd(), '../../reference/privacy.html'), 'utf-8');

export const dynamic = 'force-static';

export function GET() {
  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
