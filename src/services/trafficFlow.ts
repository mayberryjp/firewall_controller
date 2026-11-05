import type { Config, Statistics } from "@/types/domain";
import { emptyTrafficRates, usableTrafficSample, type TrafficFrame, type TrafficRates } from "@/services/traffic";
import { formatBytes } from "@/services/hostHealth";
import type { InterfaceCapabilitySnapshot } from "@/services/interfaceCapabilities";

export type FlowRole = "wan" | "lan";
export interface FlowPort {
  name: string;
  role: FlowRole;
  kind: string;
  state: "up" | "down" | "unknown";
  canFlow: boolean;
  error: string | null;
  rates: TrafficRates;
  counters: Record<string, string> | null;
  speedMbps: number | null;
}

export function flowPorts(config: Config | undefined, sample: Statistics | null, frame: TrafficFrame | null, snapshot: InterfaceCapabilitySnapshot | null = null): FlowPort[] {
  const measured = sample && usableTrafficSample(sample);
  const interfaces = new Map(sample?.interfaces.map(item => [item.name, item]));
  const configured = new Map(config?.interfaces.map(item => [item.name, item]));
  const links = new Map(snapshot?.inventory.source === "native" && snapshot.inventory.status !== "simulated"
    ? snapshot.inventory.interfaces.map(item => [item.name, item.link]) : []);
  function speed(name: string): number | null {
    const visited = new Set<string>();
    let current: string | undefined = name;
    while (current && !visited.has(current)) {
      visited.add(current);
      const link = links.get(current), value = link?.speed_mbps;
      if (value != null && Number.isFinite(value) && value > 0 && link?.carrier !== false) return value;
      const item = configured.get(current);
      current = item?.kind === "vlan" ? item.vlan.parent : undefined;
    }
    return null;
  }
  return (config?.interfaces ?? []).flatMap(item => {
    if (!item.up || (item.role !== "wan" && item.role !== "lan")) return [];
    const observed = interfaces.get(item.name);
    const available = measured && observed?.status === "available" && !observed.error && observed.counters !== null;
    const operational = observed?.oper_state.toUpperCase();
    const down = measured && observed?.status === "available" && !observed.error &&
      (!observed.admin_up || ["DOWN", "LOWERLAYERDOWN", "NOTPRESENT", "DORMANT"].includes(operational ?? ""));
    if (down) return [];
    return [{
      name: item.name, role: item.role, kind: item.kind,
      state: measured && observed?.status === "available" && !observed.error && operational === "UP" ? "up" : "unknown",
      canFlow: Boolean(available),
      error: observed?.error || (sample && measured && !observed ? "No counters returned for this interface." :
        observed && measured && !available ? "Interface counters are unavailable." : null),
      rates: available ? frame?.interfaces[item.name] ?? emptyTrafficRates() : emptyTrafficRates(),
      counters: available ? observed.counters : null,
      speedMbps: speed(item.name),
    }];
  });
}

const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
export function formatFlowRate(bytesPerSecond: number | null): string {
  if (bytesPerSecond === null || !Number.isFinite(bytesPerSecond * 8) || bytesPerSecond < 0) return "Unavailable";
  let value = bytesPerSecond * 8, unit = 0;
  const units = ["b/s", "Kb/s", "Mb/s", "Gb/s", "Tb/s", "Pb/s", "Eb/s"];
  while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit++; }
  return `${number.format(value)} ${units[unit]}`;
}
export function formatFlowPackets(value: number | null): string {
  return value === null || !Number.isFinite(value) || value < 0 ? "Unavailable" : `${number.format(value)} pps`;
}
export function flowCounter(port: FlowPort, key: string): string | null {
  const value = port.counters?.[key];
  return value !== undefined && /^\d+$/.test(value) ? value : null;
}
export function flowTotal(port: FlowPort, key: string): string {
  return formatBytes(flowCounter(port, key));
}
export function flowDrops(port: FlowPort): string {
  const rx = flowCounter(port, "rx_dropped"), tx = flowCounter(port, "tx_dropped");
  return rx === null || tx === null ? "Unavailable" : number.format(BigInt(rx) + BigInt(tx));
}
export function flowMotion(rate: number | null, speedMbps: number | null) {
  const active = rate !== null && Number.isFinite(rate) && rate > 0;
  const intensity = active ? Math.log10(rate + 1) : 0;
  const utilization = active && speedMbps !== null && Number.isFinite(speedMbps) && speedMbps > 0
    ? Math.min(1, rate / (speedMbps * 125000)) : null;
  const duration = utilization === null ? 6 : 1 / (1 / 6 + utilization * (1 / 0.65 - 1 / 6));
  return { active, utilization, duration: `${duration}s`, width: Math.min(7, 2 + intensity * 0.45) };
}
export function flowLinkPath(width: number, index: number, count: number, role: FlowRole, offset: number, applianceWidth = Math.min(520, width - 40)): string {
  const position = (index + 0.5) / count;
  const node = width * position + offset;
  const port = width / 2 + (position - 0.5) * Math.min(280, applianceWidth * 0.6) + offset;
  const start = role === "wan" ? node : port, end = role === "wan" ? port : node;
  return `M ${start} 0 C ${start} 85, ${end} 65, ${end} 152`;
}
