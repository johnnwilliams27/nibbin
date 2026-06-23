/**
 * brain-sources Storage path utilities.
 *
 * All uploads use the layout: `{accountId}/{sourceId}/{sanitizedFilename}`
 *
 * - accountId  — UUID from the authenticated session (never client-supplied)
 * - sourceId   — UUID generated server-side at upload time
 * - sanitizedFilename — filename with `/`, `\`, null bytes, and leading dots
 *   stripped to prevent path traversal
 *
 * The path-prefix isolation guarantee (account A cannot read account B's files)
 * is enforced at the Storage-bucket level by a Supabase Storage policy applied
 * via `scripts/bootstrap-brain-sources-bucket.ts`. These utility functions
 * ensure no server-side code ever constructs a path outside `{accountId}/`.
 */

/**
 * Strip characters that could allow path traversal from a filename.
 * Replaces `/`, `\`, and null bytes with `_`, and removes leading dots.
 */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\\x00]/g, '_') // strip path separators + null bytes
    .replace(/^\.+/, '_');       // replace leading dots
}

/**
 * Build the canonical Storage object path for a brain-sources upload.
 * Format: `{accountId}/{sourceId}/{sanitizedFilename}`
 *
 * Both accountId and sourceId are UUIDs generated server-side from the
 * authenticated session and crypto.randomUUID() respectively — they are
 * never derived from client input, so they cannot contain traversal characters.
 */
export function buildStoragePath(accountId: string, sourceId: string, filename: string): string {
  return `${accountId}/${sourceId}/${sanitizeFilename(filename)}`;
}

/**
 * Validate that a storage path starts with the expected account prefix.
 * Used as a defense-in-depth assertion in the download path.
 *
 * Returns true if path starts with `{accountId}/`, false otherwise.
 */
export function isPathOwnedByAccount(path: string, accountId: string): boolean {
  return path.startsWith(`${accountId}/`);
}
