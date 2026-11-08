import { ApiFailure } from "@/services/api";
import { getFirewallDenyLog } from "@/services/netcontrol";
import type { FirewallDenyPage } from "@/services/firewallTelemetry";
import { compareInterfaceNames, formatInterfaceName } from "@/services/interfaceNames";
import { formatIpProtocol } from "@/services/firewallProtocols";

export const missingRulePeriods = [
  { title: "Last hour", value: 1 },
  { title: "Last 4 hours", value: 4 },
  { title: "Last 8 hours", value: 8 },
  { title: "Last day", value: 24 },
  { title: "Last week", value: 168 },
];
const historyHours = 168;

type Drop = FirewallDenyPage["records"][number];
export interface MissingRuleSummary {
  id: string;
  source: string;
  destination: string;
  destinationPort: number | null;
  protocol: number;
  packets: bigint;
  bytes: bigint;
  lastSeen: number;
  ingress: string[];
  egress: string[];
  chains: string[];
  reasons: string[];
}
export interface MissingRuleHistory {
  records: Drop[];
  until: number;
  warnings: string[];
}
export type MissingRuleSortColumn = Exclude<keyof MissingRuleSummary, "id">;

export function sortMissingRules(rows: readonly MissingRuleSummary[], column: MissingRuleSortColumn, descending: boolean): MissingRuleSummary[] {
  const value = (row: MissingRuleSummary) => {
    if (column === "protocol") return formatIpProtocol(row.protocol);
    const result = row[column];
    return Array.isArray(result) ? result.join(", ") : result;
  };
  return [...rows].sort((left, right) => {
    const first = value(left), second = value(right);
    if (first === null) return second === null ? 0 : 1;
    if (second === null) return -1;
    const comparison = typeof first === "string" && typeof second === "string"
      ? first.localeCompare(second, undefined, { numeric: true, sensitivity: "base" })
      : first < second ? -1 : first > second ? 1 : 0;
    return descending ? -comparison : comparison;
  });
}

export function summarizeMissingRules(records: readonly Drop[], since: number, until: number): MissingRuleSummary[] {
  const groups = new Map<string, MissingRuleSummary>();
  const seen = new Set<string>();
  for (const row of records) {
    if (seen.has(row.id) || row.timestamp_ms < since || row.timestamp_ms > until) continue;
    seen.add(row.id);
    const id = JSON.stringify([row.source, row.destination, row.destination_port, row.protocol]);
    let group = groups.get(id);
    if (!group) {
      group = {
        id, source: row.source, destination: row.destination, destinationPort: row.destination_port,
        protocol: row.protocol, packets: 0n, bytes: 0n, lastSeen: row.timestamp_ms,
        ingress: [], egress: [], chains: [], reasons: [],
      };
      groups.set(id, group);
    }
    group.packets++;
    group.bytes += BigInt(row.packet_length);
    group.lastSeen = Math.max(group.lastSeen, row.timestamp_ms);
    for (const [values, value] of [
      [group.ingress, row.ingress !== null ? formatInterfaceName(row.ingress) : row.ingress_index !== null ? `Index ${row.ingress_index}` : "Unavailable"],
      [group.egress, row.egress !== null ? formatInterfaceName(row.egress) : row.egress_index !== null ? `Index ${row.egress_index}` : "Unavailable"],
      [group.chains, row.chain],
      [group.reasons, row.reason === "policy" ? "Default policy" : "Rule drop"],
    ] as const) {
      if (!values.includes(value)) values.push(value);
    }
  }
  for (const group of groups.values()) {
    group.ingress.sort(compareInterfaceNames); group.egress.sort(compareInterfaceNames);
    group.chains.sort(); group.reasons.sort();
  }
  return [...groups.values()].sort((left, right) =>
    left.packets !== right.packets ? left.packets > right.packets ? -1 : 1 : left.id.localeCompare(right.id));
}

export async function readMissingRuleHistory(until: number, signal: AbortSignal): Promise<MissingRuleHistory> {
  const records: Drop[] = [], warnings = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await getFirewallDenyLog({
      limit: 500, since_ms: Math.max(0, until - historyHours * 3600000), until_ms: until, before_id: cursor,
    }, signal);
    if (signal.aborted) throw new DOMException("The history read was aborted.", "AbortError");
    if (page.next_before_id && cursor && BigInt(page.next_before_id) >= BigInt(cursor)) {
      throw new Error("The backend returned a non-advancing history cursor.");
    }
    records.push(...page.records);
    if (page.cursor_expired) warnings.add("Retention gap: older records expired during this read. Totals are incomplete.");
    if (page.capture.status !== "capturing" || page.capture.error) {
      warnings.add(`Capture: ${page.capture.status}. ${page.capture.error ?? ""} Retained history is shown; capture is not healthy.`);
    }
    if ([page.capture.discarded_records, page.capture.malformed_records, page.capture.overflow_events, page.capture.sequence_gaps].some(value => value !== "0")) {
      warnings.add("Capture loss was reported. Totals are incomplete; loss indicators are not an exact lost-packet total.");
    }
    cursor = page.next_before_id ?? undefined;
  } while (cursor);
  return { records, until, warnings: [...warnings] };
}

export function firewallDenyReadError(failure: unknown): string {
  const detail = failure instanceof Error ? failure.message : "Unable to load firewall drops.";
  return failure instanceof ApiFailure && failure.status === 403
    ? `Firewall drop history requires firewall.logs.read permission. ${detail}`
    : failure instanceof ApiFailure && [404, 405].includes(failure.status ?? 0)
      ? `This backend does not support firewall drop history. ${detail}`
      : failure instanceof ApiFailure && failure.status === 503
        ? `Firewall drop history is unavailable; this can include simulator or native capture/storage limitations. ${detail}`
        : detail;
}
