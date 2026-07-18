/** Case-insensitive substring match across fields. Empty query matches all. */
export function matchesQuery(
  query: string,
  ...fields: (string | null | undefined)[]
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((f) => f?.toLowerCase().includes(needle));
}
