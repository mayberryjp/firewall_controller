import type { DHCPRelayLogPage, DHCPRelayStatistics } from "@/services/dhcpDiagnostics";
import type { PersistentLogPage, LogSource } from "@/services/logs";

export const telemetryEpoch = "0123456789abcdef0123456789abcdef";
export const telemetryTimestamp = "2026-11-11T00:00:00.987654Z";
export function relayStatistics(): DHCPRelayStatistics {
  const counters = {
    requests_received: "18446744073709551615", replies_received: "2", requests_forwarded: "3",
    replies_forwarded: "1", packets_rejected: "4", rejected_by_reason: { malformed: "4" },
    send_errors: "0", transactions_expired: "6", pending_transactions: "7",
  };
  return {
    scope: "host:lab", epoch: telemetryEpoch, generation: "9007199254740993",
    counters_since: telemetryTimestamp, collected_at: telemetryTimestamp,
    totals: counters, log_capacity: 2048, log_overwritten: "0",
    worker: { name: "dhcp-relay", state: "running", retrying: false },
    interfaces: [
      { interface: "lab0", enabled: true, state: "running", counters: { ...counters } },
      { interface: "lab1", enabled: false, state: "disabled", counters: null },
    ],
  };
}
export function relayLog(sequence = "1", epoch = telemetryEpoch): DHCPRelayLogPage {
  return {
    scope: "host:lab", epoch, next_cursor: `${epoch}:${sequence}`, reset: false, gap: false,
    has_more: false, capacity: 2048, overwritten: "0",
    events: [{
      sequence, generation: "1", timestamp: telemetryTimestamp, interface: "lab0", event: "requests_forwarded",
      reason: "", peer: "192.0.2.10:67", message_type: 1, transaction_id: "0000002a", client_mac: "02:00:00:00:00:01",
    }],
  };
}
export function persistentLog(source: LogSource = "syslog", sequence = "1"): PersistentLogPage {
  return {
    source, entries: [{ sequence, timestamp: telemetryTimestamp, message: `${source} entry ${sequence}` }],
    next_cursor: `${telemetryEpoch}:${sequence}`, oldest_cursor: `${telemetryEpoch}:0`,
    gap: false, reset: false, has_more: false, retention_bytes: 8388608, max_message_bytes: 65000,
    capture: { state: "running", retrying: false, error: null },
  };
}
