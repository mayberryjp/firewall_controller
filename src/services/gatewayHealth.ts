import type { GatewayMonitor, GatewayStatistics } from "@/types/domain";

export function gatewaySampleState(row: GatewayStatistics, config: GatewayMonitor | undefined, now: number, stale: boolean): string {
  if (row.sample_status !== "available" && row.sample_status !== "warming_up") return row.sample_status;
  if (stale || !config || !row.collected_at || now - Date.parse(row.collected_at) > Math.max(1000, 3 * config.probe_interval_ms)) return "stale";
  return row.sample_status;
}
export function gatewayHealth(row: GatewayStatistics, config: GatewayMonitor | undefined, now: number, stale: boolean): string {
  return config?.enabled === true && row.process_state === "running" && !row.error && gatewaySampleState(row, config, now, stale) === "available" &&
    ["up", "degraded", "down"].includes(row.health) ? row.health : "unknown";
}
export const formatMetric = (value: number | null, unit: string): string =>
  value === null ? "Unavailable" : `${value} ${unit}`;
