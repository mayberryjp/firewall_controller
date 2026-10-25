const isoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && isoTimestamp.test(value);
}

export function formatTimestamp(value: string | number | null | undefined, missing = "Unavailable"): string {
  if (value === null || value === undefined || value === "") return missing;
  if (typeof value === "string" && !isTimestamp(value)) return "Invalid timestamp";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Invalid timestamp";
  return date.toISOString().slice(0, 19).replace("T", " ");
}
