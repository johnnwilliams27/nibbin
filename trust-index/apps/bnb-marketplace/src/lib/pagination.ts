export const PAGE_SIZE = 12;

export function readPage(search: string): number {
  const value = new URLSearchParams(search).get('page') ?? '1';
  const number = Number(value);
  return /^\d+$/.test(value) && Number.isSafeInteger(number) && number > 0 ? number : 1;
}

export function writePage(search: string, page: number): string {
  const params = new URLSearchParams(search);
  if (page > 1) params.set('page', String(page));
  else params.delete('page');
  return params.toString();
}

/** A page may straddle measured and unknown groups without inventing a rank. */
export function paginateGroups<T>(ranked: T[], unranked: T[], requestedPage: number) {
  const total = ranked.length + unranked.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(pageCount, Math.max(1, Number.isSafeInteger(requestedPage) ? requestedPage : 1));
  const offset = (page - 1) * PAGE_SIZE;
  const end = Math.min(offset + PAGE_SIZE, total);
  return {
    page, pageCount, total, start: total ? offset + 1 : 0, end,
    ranked: ranked.slice(offset, end),
    unranked: unranked.slice(Math.max(0, offset - ranked.length), Math.max(0, end - ranked.length)),
  };
}

export function pageNumbers(page: number, pageCount: number): Array<number | 'gap'> {
  const visible = new Set([1, pageCount, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((n) => visible.add(n));
  if (page >= pageCount - 2) [pageCount - 3, pageCount - 2, pageCount - 1].forEach((n) => visible.add(n));
  const pages = [...visible].filter((n) => n >= 1 && n <= pageCount).sort((a, b) => a - b);
  return pages.flatMap((n, i): Array<number | 'gap'> => i && n - pages[i - 1] > 1 ? ['gap', n] : [n]);
}

export function pageAfterChange(page: number, patch: object): number {
  return ['query', 'filters', 'categories', 'sort'].some((key) => Object.hasOwn(patch, key)) ? 1 : page;
}
