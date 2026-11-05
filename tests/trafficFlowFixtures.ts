import { config, trafficStatistics } from "./fixtures";
import type { Config, Statistics } from "@/types/domain";
import { interfaceCapabilitySnapshot } from "./diagnosticsFixtures";

export function trafficFlowConfig(): Config {
  const value = config(), base = value.interfaces[0]!;
  value.interfaces = [
    { ...base, kind: "ethernet", name: "wan0", role: "wan", addresses: ["198.51.100.2/24"] },
    { ...base, kind: "ethernet", name: "lab0", role: "lan" },
    { ...base, kind: "ethernet", name: "lan1", role: "lan", addresses: ["10.1.0.1/24"] },
    { ...base, kind: "vlan", name: "guest20", role: "lan", addresses: ["10.20.0.1/24"], vlan: { parent: "lan1", id: 20 } },
  ];
  value.routes = value.routes.map(route => ({ ...route, interface: "wan0", gateway: "198.51.100.1" }));
  value.system = { hostname: "edge-fw-01", domain: "", timezone: "Asia/Tokyo" };
  return value;
}

export function trafficFlowStatistics(seconds = 0, increment = 0n): Statistics {
  const value = trafficStatistics(seconds);
  value.interfaces = trafficFlowConfig().interfaces.map((link, index) => {
    const change = increment * BigInt(index + 1);
    return {
      ...value.interfaces[0]!, name: link.name, kind: link.kind, index: index + 10,
      mac: `02:00:00:00:00:0${index}`,
      counters: {
        rx_bytes: (1000000000000n + change).toString(), tx_bytes: (200000000000n + change / 2n).toString(),
        rx_packets: (1000000000n + change / 1000n).toString(), tx_packets: (200000000n + change / 2000n).toString(),
        rx_dropped: String(index), tx_dropped: "0",
      },
    };
  });
  return value;
}

export function trafficFlowCapabilities(speedMbps = 1000) {
  const snapshot = interfaceCapabilitySnapshot(), base = snapshot.inventory.interfaces[0]!;
  snapshot.inventory.interfaces = trafficFlowStatistics().interfaces.filter(link => link.kind === "ethernet").map(link => ({
    ...base, name: link.name, index: link.index ?? null, mac: link.mac ?? null, link: { ...base.link!, speed_mbps: speedMbps },
  }));
  return snapshot;
}
