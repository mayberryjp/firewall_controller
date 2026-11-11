import { useDiagnosticRead } from "@/composables/useDiagnosticRead";
import { utf8Size } from "@/services/json";

interface CursorPage { next_cursor: string; reset: boolean; gap: boolean; has_more: boolean }
interface Entry { sequence: string }
export interface LogHistory<E, P> {
  entries: E[]; page: P; cursor: string; gap: boolean; reset: boolean; trimmed: boolean;
}

export function useLogHistory<E extends Entry, P extends CursorPage>(
  reader: (cursor: string | undefined, signal: AbortSignal) => Promise<{ entries: E[]; page: P }>,
  interval: number,
  key: () => string,
  enabled: () => boolean = () => true,
  startCursor: () => string | undefined = () => undefined,
) {
  return useDiagnosticRead<LogHistory<E, P>>(async (signal, previous) => {
    let entries = previous?.entries ?? [], cursor = previous?.cursor ?? startCursor();
    let gap = previous?.gap ?? false, reset = previous?.reset ?? false, trimmed = previous?.trimmed ?? false;
    for (let count = 0; count < 4; count++) {
      const result = await reader(cursor, signal), page = result.page;
      if (signal.aborted) throw new Error("Log read cancelled");
      const changed = cursor !== undefined && cursor.split(":")[0] !== page.next_cursor.split(":")[0];
      if (page.reset || changed) { entries = []; gap = false; trimmed = false; reset = true; }
      const last = entries.at(-1)?.sequence;
      let earlier: string | undefined;
      for (const entry of result.entries) {
        if (earlier !== undefined && BigInt(entry.sequence) <= BigInt(earlier)) throw new Error("Log entries are not in sequence order.");
        if (cursor !== undefined && !page.reset && !changed && BigInt(entry.sequence) <= BigInt(cursor.split(":")[1]!)) {
          throw new Error("Log page repeated entries before its cursor.");
        }
        earlier = entry.sequence;
      }
      if (earlier !== undefined && BigInt(earlier) > BigInt(page.next_cursor.split(":")[1]!)) throw new Error("Log cursor precedes its entries.");
      if (cursor === page.next_cursor && page.has_more) throw new Error("The backend returned a non-advancing log cursor.");
      if (cursor !== undefined && !page.reset && !changed && BigInt(page.next_cursor.split(":")[1]!) < BigInt(cursor.split(":")[1]!)) {
        throw new Error("The backend returned a backwards log cursor.");
      }
      entries = [...entries, ...result.entries.filter(entry => last === undefined || BigInt(entry.sequence) > BigInt(last))];
      gap ||= page.gap;
      let bytes = 2;
      let first = entries.length;
      while (first > 0 && entries.length - first < 2048) {
        const size = utf8Size(JSON.stringify(entries[first - 1])) + (first < entries.length ? 1 : 0);
        if (bytes + size > 2 * 1024 * 1024) break;
        bytes += size; first--;
      }
      if (first > 0) { entries = entries.slice(first); trimmed = true; }
      cursor = page.next_cursor;
      if (!page.has_more || count === 3) return { entries, page, cursor, gap, reset, trimmed };
    }
    throw new Error("Unable to read log history");
  }, interval, key, enabled);
}
