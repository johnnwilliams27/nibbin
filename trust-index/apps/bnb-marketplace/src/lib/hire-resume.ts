/** URL input may prefill a job ID; it never authorizes a wallet operation. */
export function readResumeJob(search: string): string | null {
  const values = new URLSearchParams(search).getAll('job');
  if (values.length !== 1 || !/^[1-9][0-9]{0,77}$/.test(values[0])) return null;
  return BigInt(values[0]) < 2n ** 256n ? values[0] : null;
}
