import type { Statistics } from "@/types/domain";

export const trafficCounters = ["rx_bytes", "tx_bytes", "rx_packets", "tx_packets"] as const;
export type TrafficCounter = typeof trafficCounters[number];
export type TrafficRates = Record<TrafficCounter, number | null>;
export interface TrafficFrame {
  time: number;
  interfaces: Record<string, TrafficRates>;
  total: TrafficRates;
}
export const trafficHistoryLimit = 120;
export const emptyTrafficRates = (): TrafficRates => ({ rx_bytes: null, tx_bytes: null, rx_packets: null, tx_packets: null });

export function usableTrafficSample(data: Statistics): boolean {
  return ["available", "partial"].includes(data.sample.status) && Number.isFinite(Date.parse(data.sample.collected_at));
}

function identity(item: Statistics["interfaces"][number]): string {
  return JSON.stringify([item.index, item.mac, item.kind, item.counter_bits]);
}

function counter(item: Statistics["interfaces"][number], key: TrafficCounter): bigint | null {
  const value = item.counters?.[key];
  return item.status === "available" && !item.error && value !== undefined && /^\d+$/.test(value) ? BigInt(value) : null;
}

export function trafficFrame(previous: Statistics | null, current: Statistics): TrafficFrame {
  const time = Date.parse(current.sample.collected_at);
  const elapsed = previous ? (time - Date.parse(previous.sample.collected_at)) / 1000 : 0;
  // started_at is the start of each collection, not the lifetime of the counters.
  const comparable = previous && usableTrafficSample(previous) && usableTrafficSample(current) && elapsed > 0 &&
    previous.sample.scope === current.sample.scope;
  const before = new Map(previous?.interfaces.map(item => [item.name, item]));
  const interfaces: TrafficFrame["interfaces"] = {};
  for (const item of current.interfaces) {
    const rates = emptyTrafficRates(), earlier = before.get(item.name);
    if (comparable && earlier && identity(earlier) === identity(item)) {
      for (const key of trafficCounters) {
        const value = counter(item, key), baseline = counter(earlier, key);
        if (value === null || baseline === null || value < baseline) continue;
        const rate = Number(value - baseline) / elapsed;
        if (Number.isFinite(rate)) rates[key] = rate;
      }
    }
    interfaces[item.name] = rates;
  }
  const total = emptyTrafficRates();
  const sameInterfaces = previous?.interfaces.length === current.interfaces.length &&
    current.interfaces.every(item => before.has(item.name));
  if (sameInterfaces && current.interfaces.length) {
    for (const key of trafficCounters) {
      const values = Object.values(interfaces).map(rates => rates[key]);
      if (values.every(value => value !== null)) {
        const sum = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
        if (Number.isFinite(sum)) total[key] = sum;
      }
    }
  }
  return { time, interfaces, total };
}
