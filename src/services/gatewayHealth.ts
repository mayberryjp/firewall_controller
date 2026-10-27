import type { GatewayMonitor, GatewayStatistics } from "@/types/domain";

export function gatewaySampleState(row: GatewayStatistics, config: GatewayMonitor | undefined, now: number, stale: boolean): string {
  if (row.sample_status !== "available" && row.sample_status !== "warming_up") return row.sample_status;
  if (row.retrying || stale || !config || !row.collected_at || now - Date.parse(row.collected_at) > Math.max(1000, 3 * config.probe_interval_ms)) return "stale";
  return row.sample_status;
}
export function gatewayHealth(row: GatewayStatistics, config: GatewayMonitor | undefined, now: number, stale: boolean): string {
  return config?.enabled === true && row.process_state === "running" && !row.retrying && !row.error && gatewaySampleState(row, config, now, stale) === "available" &&
    ["up", "degraded", "down"].includes(row.health) ? row.health : "unknown";
}
const metricFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, useGrouping: false });
export const formatMetric = (value: number | null, unit: string): string =>
  value === null ? "Unavailable" : `${metricFormat.format(value)} ${unit}`;

const metricBands = {
  Loss: { thresholds: [1, 3, 5], unit: "%", note: "Display guidance only; loss excludes pending probes." },
  "Mean RTT": { thresholds: [100, 150, 300], unit: "ms", note: "Round-trip latency, not one-way delay. Display guidance only." },
  Stddev: { thresholds: [10, 20, 30], unit: "ms", note: "Population RTT standard deviation. Display heuristic, not an RTP jitter standard." },
  "RTT variation": { thresholds: [10, 20, 30], unit: "ms", note: "Mean absolute RTT difference between adjacent replied probes. Display heuristic, not one-way/RTP jitter." },
} as const;
const metricColors = ["green", "yellow", "orange", "red"] as const;
const metricRatings = ["Good", "Fair", "Warning", "Poor"] as const;

export function gatewayMetricIndicator(metric: keyof typeof metricBands, value: number | null, available: boolean) {
  const { thresholds: [low, medium, high], unit, note } = metricBands[metric];
  const bands = `Green < ${low} ${unit}; yellow ${low} to < ${medium} ${unit}; orange ${medium} to < ${high} ${unit}; red >= ${high} ${unit}.`;
  if (value === null || !available) {
    return { color: "default", rating: "Unrated", tooltip: `${metric}: ${formatMetric(value, unit)}. ${value === null ? "Unavailable" : "No current sample"}; no quality rating. ${bands} ${note}` };
  }
  const level = value < low ? 0 : value < medium ? 1 : value < high ? 2 : 3;
  return { color: metricColors[level], rating: metricRatings[level], tooltip: `${metric}: ${formatMetric(value, unit)} (${metricRatings[level]}). ${bands} ${note}` };
}
