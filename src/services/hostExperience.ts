import {
  experienceMetricColor, experienceNumber, experienceRate, type ExperienceHistory, type ExperienceSample,
} from "@/services/networkExperience";
import { formatBytes } from "@/services/hostHealth";

type MetricDefinition = {
  label: string;
  source: "traffic" | "tcp" | "dns" | "firewall" | "connections";
  unit: "rate" | "ms" | "count" | "bytes";
  read: (sample: ExperienceSample) => number | string | null;
};
export const hostExperienceMetrics = {
  download: { label: "Download", source: "traffic", unit: "rate", read: sample => sample.traffic.received_bps },
  upload: { label: "Upload", source: "traffic", unit: "rate", read: sample => sample.traffic.sent_bps },
  dns_p95: { label: "DNS Response", source: "dns", unit: "ms", read: sample => sample.dns.response_time_p95_ms },
  dns_unanswered: { label: "Unanswered DNS", source: "dns", unit: "count", read: sample => sample.dns.unanswered },
  dns_servfail: { label: "DNS SERVFAIL", source: "dns", unit: "count", read: sample => sample.dns.servfail_responses },
  remote_p50: { label: "Remote RTT Median", source: "tcp", unit: "ms", read: sample => sample.tcp.rtt_remote.p50_ms },
  remote_p95: { label: "Remote RTT", source: "tcp", unit: "ms", read: sample => sample.tcp.rtt_remote.p95_ms },
  host_p50: { label: "Host RTT Median", source: "tcp", unit: "ms", read: sample => sample.tcp.rtt_host.p50_ms },
  host_min_window: { label: "Host Min Window", source: "tcp", unit: "bytes", read: sample => sample.tcp.advertised_window_min_bytes_host },
  host_window_decreases: { label: "Window Decreases", source: "tcp", unit: "count", read: sample => sample.tcp.window_decreases_host },
  host_zero_window: { label: "Host Zero Windows", source: "tcp", unit: "count", read: sample => sample.tcp.zero_window_observations_host },
  peer_zero_window: { label: "Peer Zero Windows", source: "tcp", unit: "count", read: sample => sample.tcp.zero_window_observations_peer },
  connections: { label: "Total Connections", source: "connections", unit: "count", read: sample => sample.connections.total },
  established: { label: "Established TCP", source: "connections", unit: "count", read: sample => sample.connections.tcp_established },
  unreplied: { label: "Unreplied Connections", source: "connections", unit: "count", read: sample => sample.connections.unreplied },
  drops_sent: { label: "Upload Firewall Drops", source: "firewall", unit: "count", read: sample => sample.firewall.dropped_sent_packets },
  drops_received: { label: "Download Firewall Drops", source: "firewall", unit: "count", read: sample => sample.firewall.dropped_received_packets },
  retrans_sent: { label: "Upload TCP Repeats", source: "tcp", unit: "count", read: sample => sample.tcp.retransmission_observations_sent },
  retrans_received: { label: "Download TCP Repeats", source: "tcp", unit: "count", read: sample => sample.tcp.retransmission_observations_received },
} satisfies Record<string, MetricDefinition>;
export type HostExperienceMetric = keyof typeof hostExperienceMetrics;

export function hostMetricValue(sample: ExperienceSample | null, key: HostExperienceMetric): number | string | null {
  const metric = hostExperienceMetrics[key];
  return sample && ["available", "partial"].includes(sample[metric.source].status) ? metric.read(sample) : null;
}
export function formatHostMetric(sample: ExperienceSample | null, key: HostExperienceMetric): string {
  const value = hostMetricValue(sample, key), metric = hostExperienceMetrics[key];
  if (value === null) return sample?.[metric.source].status === "not_observed" ? "Not observed" : "Unavailable";
  if (typeof value === "string") return value;
  if (metric.unit === "rate") return experienceRate(value);
  if (metric.unit === "ms") return `${experienceNumber(value)} ms`;
  if (metric.unit === "bytes") return formatBytes(String(value), 2);
  return String(value);
}
export function hostMetricColor(sample: ExperienceSample | null, key: HostExperienceMetric, stale = false): string {
  const value = hostMetricValue(sample, key);
  if (value === null || stale) return "default";
  if (key === "dns_p95" && typeof value === "number") return experienceMetricColor(value, "dns");
  if (key === "remote_p95" && typeof value === "number") return experienceMetricColor(value, "rtt");
  if (key === "drops_sent" || key === "drops_received") return experienceMetricColor(BigInt(value), "drops");
  if (["dns_servfail", "dns_unanswered", "host_zero_window", "peer_zero_window"].includes(key) && BigInt(value) > 0n) return "warning";
  return "info";
}
export function hostChartValue(sample: ExperienceSample | null, key: HostExperienceMetric): number | null {
  const value = hostMetricValue(sample, key);
  if (typeof value !== "string") return value;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}
export type HostFinding = { label: string; color: string; detail: string };
export function hostFindings(sample: ExperienceSample | null): HostFinding[] {
  if (!sample) return [];
  const findings: HostFinding[] = [];
  for (const key of ["dns_p95", "remote_p95"] as const) {
    const value = hostMetricValue(sample, key);
    if (typeof value === "number" && value >= 100) findings.push({
      label: key === "dns_p95" ? "Elevated DNS Response" : "Elevated Remote RTT",
      color: hostMetricColor(sample, key),
      detail: `${formatHostMetric(sample, key)} p95 in this interval. Passive timing is an observation, not a connectivity test.`,
    });
  }
  const counts = [
    { keys: ["dns_unanswered"], label: "Unanswered DNS Requests", color: "warning", detail: "Client-visible DNS requests did not have an observed reply. Missing capture evidence is not proof of a resolver failure." },
    { keys: ["dns_servfail"], label: "DNS SERVFAIL Responses", color: "error", detail: "The host received DNS server-failure responses during this interval." },
    { keys: ["retrans_received", "retrans_sent"], label: "TCP Repeats Observed", color: "warning", detail: "Repeated TCP data was observed. This is not a confirmed packet-loss count." },
    { keys: ["host_zero_window"], label: "Host Receive Pressure", color: "warning", detail: "The host advertised zero receive capacity during this interval." },
    { keys: ["peer_zero_window"], label: "Peer Receive Pressure", color: "warning", detail: "The peer advertised zero receive capacity during this interval." },
    { keys: ["drops_sent", "drops_received"], label: "Managed Firewall Drops", color: "info", detail: "Managed firewall policy dropped packets. These can be intentional and do not lower the backend experience score." },
    { keys: ["unreplied"], label: "Unreplied Connections", color: "info", detail: "Tracked connections have not received a reply. New or one-way connections are not necessarily failures." },
  ] satisfies { keys: HostExperienceMetric[]; label: string; color: string; detail: string }[];
  for (const entry of counts) {
    if (entry.keys.some(key => {
      const value = hostMetricValue(sample, key);
      return value !== null && BigInt(value) > 0n;
    })) findings.push({ label: entry.label, color: entry.color, detail: entry.detail });
  }
  for (const source of ["traffic", "tcp", "dns", "firewall", "connections"] as const) {
    if (sample[source].error) findings.push({ label: `${source.toUpperCase()} Read Failure`, color: "error", detail: sample[source].error });
  }
  if (sample.experience.level === "poor" || sample.experience.level === "fair") findings.push({
    label: `${sample.experience.level === "poor" ? "Poor" : "Fair"} Experience`,
    color: sample.experience.level === "poor" ? "error" : "warning",
    detail: sample.experience.reasons.length ? sample.experience.reasons.join(", ").replaceAll("_", " ") : "The backend rated this observation below good experience.",
  });
  if (!sample.coverage.complete) findings.push({
    label: "Incomplete Observation", color: "default",
    detail: sample.coverage.reasons.length ? sample.coverage.reasons.join(", ").replaceAll("_", " ") : "Some evidence is unavailable for this interval.",
  });
  return findings;
}
export function latestHostObservation(history: ExperienceHistory): number {
  for (let index = history.samples.length - 1; index >= 0; index--) {
    if (history.samples[index]?.sample) return index;
  }
  return history.samples.length - 1;
}
export function hostHistoryPoints(history: ExperienceHistory) {
  const result: { slotIndex: number | null; at: string; sample: ExperienceSample | null }[] = [];
  let previous: ExperienceSample | null = null;
  history.samples.forEach((slot, slotIndex) => {
    const current = slot.sample;
    if (current && previous && (current.observation_epoch !== previous.observation_epoch ||
      current.configured_host_id !== previous.configured_host_id || current.interface?.name !== previous.interface?.name ||
      current.interface?.index !== previous.interface?.index || current.interface?.kind !== previous.interface?.kind ||
      current.interface?.vlan_id !== previous.interface?.vlan_id ||
      current.configuration_revision !== previous.configuration_revision || previous.end_at !== current.start_at)) {
      result.push({ slotIndex: null, at: slot.start_at, sample: null });
    }
    result.push({ slotIndex, at: slot.end_at, sample: current });
    previous = current;
  });
  return result;
}
