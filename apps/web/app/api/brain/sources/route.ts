import { NextResponse, type NextRequest } from 'next/server';
import { appSession } from '../../../../lib/auth/app-session';
import {
  parseSourcesParams,
  mapRowToSourceListItem,
  groupToMimeFilter,
  type SourceListItem,
} from '../../../app/memory/sourcesQuery';

export const dynamic = 'force-dynamic';

// TODO: content search via match_sources when present (P5)

export async function GET(req: NextRequest): Promise<NextResponse> {
  let session: Awaited<ReturnType<typeof appSession>>;
  try {
    session = await appSession();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { supabase, accountId } = session;
  const params = parseSourcesParams(req.nextUrl.searchParams);

  // Build the base query — always account-scoped
  let query = supabase
    .from('sources')
    .select('id, title, mime_type, byte_size, captured_at, extraction_state, storage_path', {
      count: 'exact',
    })
    .eq('account_id', accountId);

  // Title search (title-only; content search via match_sources is P5)
  // Escape LIKE metacharacters so user input is treated as a literal substring.
  if (params.q) {
    const escapedQ = params.q.replace(/[\\%_]/g, (c) => '\\' + c);
    query = query.ilike('title', '%' + escapedQ + '%');
  }

  // Group filter — translate to mime_type patterns
  if (params.group) {
    const filters = groupToMimeFilter(params.group);
    if (filters.length > 0) {
      // Build an OR filter of ilike patterns over mime_type
      const orClause = filters
        .map((f) => `${f.column}.ilike.${f.pattern}`)
        .join(',');
      query = query.or(orClause);
    }
  }

  // Extraction state filter
  if (params.state) {
    query = query.eq('extraction_state', params.state);
  }

  // Sort + paginate
  query = query
    .order(params.sort, { ascending: params.dir === 'asc' })
    .range(params.offset, params.offset + params.limit - 1);

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: 'query_failed' }, { status: 502 });
  }

  const sources: SourceListItem[] = (data ?? []).map((row) =>
    mapRowToSourceListItem(row as Record<string, unknown>),
  );

  return NextResponse.json({ sources, total: count ?? 0 });
}
