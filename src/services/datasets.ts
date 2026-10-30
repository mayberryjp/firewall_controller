export function isInitialLoad(query: { data: unknown; lastSuccess: number | null; error: string | null }): boolean {
  return query.data === null && query.lastSuccess === null && !query.error;
}
