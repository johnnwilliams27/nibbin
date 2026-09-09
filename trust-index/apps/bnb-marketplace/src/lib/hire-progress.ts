/** Reflect confirmed job state; a submitted transaction is not progress on its own. */
export function hireProgress(connected: boolean, quoted: boolean, status: number | null): { current: number | null; notice: string | null } {
  if (status === 3) return { current: 4, notice: null };
  if (status === 1 || status === 2) return { current: 3, notice: null };
  if (status === 0) return { current: 2, notice: null };
  if (status !== null) return { current: null, notice: status === 4 ? 'Job rejected' : status === 5 ? 'Job expired' : 'Check job status' };
  return { current: !connected ? 0 : quoted ? 2 : 1, notice: null };
}
