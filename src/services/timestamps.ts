const isoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && isoTimestamp.test(value);
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let result = formatters.get(timeZone);
  if (!result) {
    result = new Intl.DateTimeFormat("en-GB", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    });
    formatters.set(timeZone, result);
  }
  return result;
}

export function formatTimestamp(value: string | number | null | undefined, missing = "Unavailable", timeZone = "UTC"): string {
  if (value === null || value === undefined || value === "") return missing;
  if (typeof value === "string" && !isTimestamp(value)) return "Invalid timestamp";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Invalid timestamp";
  let parts: Intl.DateTimeFormatPart[];
  try { parts = formatter(timeZone).formatToParts(date); }
  catch (error) {
    if (error instanceof RangeError) return "Invalid time zone";
    throw error;
  }
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)!.value;
  return `${part("year").padStart(4, "0")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
}

export function parseTimestamp(value: string, timeZone = "UTC"): number | undefined {
  const text = value.trim();
  if (!text) return undefined;
  formatter(timeZone);
  const wallTime = Date.parse(`${text.replace(" ", "T")}Z`);
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) || !Number.isFinite(wallTime) ||
    formatTimestamp(wallTime) !== text) {
    throw new Error(`Use a valid ${timeZone} time in yyyy-mm-dd hh:mm:ss format.`);
  }
  // Sample both sides of offset changes, then round-trip to reject skipped/repeated local times.
  const offsets = new Set<number>();
  for (const hours of [-36, 0, 36]) {
    const instant = wallTime + hours * 3600000;
    const local = formatTimestamp(instant, "Unavailable", timeZone);
    offsets.add(Date.parse(`${local.replace(" ", "T")}Z`) - instant);
  }
  const matches = [...offsets].map(offset => wallTime - offset)
    .filter(instant => formatTimestamp(instant, "Unavailable", timeZone) === text);
  if (matches.length !== 1) {
    throw new Error(`${text} is ${matches.length ? "ambiguous" : "nonexistent"} in ${timeZone} because of a clock change. Choose another time.`);
  }
  if (matches[0]! < 0) throw new Error("Enter a time on or after the Unix epoch.");
  return matches[0]!;
}
