/** Opaque offset cursor for GET /agents/:chain/:id/feedback (max page size 100, SPEC 13). */

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;

export function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | null): number {
  if (!cursor) return 0;
  try {
    const n = Number(Buffer.from(cursor, "base64url").toString("utf8"));
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

export function clampLimit(requested: number | null): number {
  if (requested === null || !Number.isFinite(requested) || requested <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.floor(requested));
}

export function paginate<T>(items: T[], cursor: string | null, limit: number): {
  items: T[];
  next_cursor: string | null;
  total: number;
} {
  const offset = decodeCursor(cursor);
  const page = items.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  return {
    items: page,
    next_cursor: nextOffset < items.length ? encodeCursor(nextOffset) : null,
    total: items.length,
  };
}
