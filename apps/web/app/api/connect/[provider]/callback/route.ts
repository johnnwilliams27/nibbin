import { NextResponse, type NextRequest } from 'next/server';
import {
  handleConnectionCallback,
  isWiredProvider,
} from '../../../../../lib/connections/callback-core';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await params;
  // 'google' is the Gmail legacy path — it has a dedicated route at
  // /api/connect/google/callback and must NOT be handled here. Any other
  // unknown or un-wired provider is also rejected before any DB work.
  if (provider === 'google' || !isWiredProvider(provider)) {
    return NextResponse.redirect(new URL('/app/connections?error=unavailable', request.url));
  }
  return handleConnectionCallback(request, { expectedProvider: provider });
}
