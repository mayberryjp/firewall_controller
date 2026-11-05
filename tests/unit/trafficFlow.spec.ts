import { describe, expect, it } from "vitest";
import { trafficFrame } from "@/services/traffic";
import { flowPorts, flowMotion, flowLinkPath, flowCounter, flowDrops, flowTotal, formatFlowRate, formatFlowPackets } from "@/services/trafficFlow";
import { trafficFlowCapabilities, trafficFlowConfig, trafficFlowStatistics } from "../trafficFlowFixtures";

describe("high-level traffic flow", () => {
  it("uses configured roles, not names, route guesses or aggregate totals", () => {
    const config = trafficFlowConfig(), data = trafficFlowStatistics();
    config.interfaces[0]!.role = "lan"; config.interfaces[1]!.role = "wan"; config.interfaces[2]!.role = "unassigned";
    data.interfaces.push({ ...data.interfaces[0]!, name: "unmanaged" });
    const ports = flowPorts(config, data, trafficFrame(null, data));
    expect(ports.map(port => [port.name, port.role])).toEqual([["wan0", "lan"], ["lab0", "wan"], ["guest20", "lan"]]);
    expect(ports[0]!.rates.rx_bytes).toBeNull();
    expect(flowTotal(ports[0]!, "rx_bytes")).toBe("1 TB");
  });
  it("keeps RX and TX separate and derives real rates only from comparable samples", () => {
    const before = trafficFlowStatistics(), after = trafficFlowStatistics(3, 3000000n);
    const ports = flowPorts(trafficFlowConfig(), after, trafficFrame(before, after));
    expect(ports[0]!.rates).toEqual({ rx_bytes: 1000000, tx_bytes: 500000, rx_packets: 1000, tx_packets: 500 });
    expect(formatFlowRate(ports[0]!.rates.rx_bytes)).toBe("8 Mb/s");
    expect(formatFlowRate(ports[0]!.rates.tx_bytes)).toBe("4 Mb/s");
    expect(formatFlowPackets(ports[0]!.rates.rx_packets)).toBe("1,000 pps");
  });
  it("does not turn simulated, missing or failed counters into measured traffic", () => {
    const data = trafficFlowStatistics();
    data.sample.status = "simulated";
    expect(flowPorts(trafficFlowConfig(), data, trafficFrame(null, data)).every(port => !port.canFlow && port.counters === null)).toBe(true);
    data.sample.status = "partial";
    data.interfaces[0]!.error = "Access denied";
    data.interfaces.pop();
    const ports = flowPorts(trafficFlowConfig(), data, null);
    expect(ports[0]!.error).toBe("Access denied");
    expect(ports[0]!.canFlow).toBe(false);
    expect(ports.at(-1)!.error).toContain("No counters returned");
    expect(flowPorts(undefined, data, null)).toEqual([]);
  });
  it("hides disabled and proven-down links without assuming virtual UNKNOWN means down", () => {
    const data = trafficFlowStatistics();
    const config = trafficFlowConfig();
    data.interfaces[0]!.admin_up = false;
    data.interfaces[1]!.oper_state = "UNKNOWN";
    data.interfaces[2]!.oper_state = "LOWERLAYERDOWN";
    config.interfaces[3]!.up = false;
    const ports = flowPorts(config, data, null);
    expect(ports.map(port => port.name)).toEqual(["lab0"]);
    expect(ports[0]!.state).toBe("unknown"); expect(ports[0]!.canFlow).toBe(true);
    data.interfaces[0]!.error = "Link read failed";
    expect(flowPorts(config, data, null)[0]).toMatchObject({ name: "wan0", state: "unknown", error: "Link read failed" });
  });
  it.each(["DOWN", "LOWERLAYERDOWN", "NOTPRESENT", "DORMANT"])("hides observed %s links and restores them after recovery", operState => {
    const data = trafficFlowStatistics();
    data.interfaces[0]!.oper_state = operState;
    expect(flowPorts(trafficFlowConfig(), data, null).map(port => port.name)).not.toContain("wan0");
    data.interfaces[0]!.oper_state = "UP";
    expect(flowPorts(trafficFlowConfig(), data, null)[0]!.name).toBe("wan0");
    data.sample.status = "simulated"; data.interfaces[0]!.oper_state = operState;
    expect(flowPorts(trafficFlowConfig(), data, null)[0]).toMatchObject({ name: "wan0", state: "unknown", canFlow: false });
  });
  it("preserves integer counter precision and distinguishes unavailable values from zero", () => {
    const data = trafficFlowStatistics();
    data.interfaces[0]!.counters = { rx_bytes: "18446744073709551615", tx_bytes: "0", rx_dropped: "9007199254740993", tx_dropped: "2" };
    const port = flowPorts(trafficFlowConfig(), data, null)[0]!;
    expect(flowCounter(port, "rx_bytes")).toBe("18446744073709551615");
    expect(flowTotal(port, "rx_bytes")).toBe("18.45 EB");
    expect(flowTotal(port, "tx_bytes")).toBe("0 B");
    expect(flowDrops(port)).toBe("9,007,199,254,740,995");
    expect(flowCounter(port, "rx_errors")).toBeNull();
    port.counters!.rx_bytes = "-1"; delete port.counters!.tx_dropped;
    expect(flowTotal(port, "rx_bytes")).toBe("Unavailable");
    expect(flowDrops(port)).toBe("Unavailable");
  });
  it.each([null, -1, Infinity, NaN])("keeps invalid rate %s visibly unavailable", value => {
    expect(formatFlowRate(value)).toBe("Unavailable");
    expect(formatFlowPackets(value)).toBe("Unavailable");
    expect(flowMotion(value, 1000).active).toBe(false);
  });
  it("shows measured zero without invented movement and scales movement within fixed bounds", () => {
    expect(formatFlowRate(0)).toBe("0 b/s");
    expect(formatFlowPackets(0)).toBe("0 pps");
    expect(flowMotion(0, 1000).active).toBe(false);
    const slow = flowMotion(1, 1000), fast = flowMotion(125000000, 1000);
    expect(slow.active).toBe(true);
    expect(Number.parseFloat(fast.duration)).toBeLessThan(Number.parseFloat(slow.duration));
    expect(fast.width).toBeGreaterThan(slow.width);
    expect(Number.parseFloat(slow.duration)).toBeCloseTo(6);
    expect(Number.parseFloat(fast.duration)).toBeCloseTo(0.65);
    expect(flowMotion(Number.MAX_VALUE, 1000)).toMatchObject({ utilization: 1, width: 7 });
  });
  it("scales each direction by utilization rather than absolute throughput", () => {
    const rx = flowMotion(1000000, 100), tx = flowMotion(500000, 100);
    expect(rx.utilization).toBe(0.08);
    expect(tx.utilization).toBe(0.04);
    expect(Number.parseFloat(rx.duration)).toBeLessThan(Number.parseFloat(tx.duration));
    expect(flowMotion(10000000, 1000).duration).toBe(rx.duration);
    expect(flowMotion(12500000, 100).duration).toBe(flowMotion(25000000, 100).duration);
    const durations = [0.01, 0.1, 0.5, 1].map(fraction => Number.parseFloat(flowMotion(12500000 * fraction, 100).duration));
    expect(durations).toEqual([...durations].sort((a, b) => b - a));
  });
  it.each([null, 0, -1, NaN, Infinity])("uses fixed movement without claiming utilization for unknown link speed %s", speed => {
    expect(flowMotion(1000000, speed)).toMatchObject({ active: true, utilization: null, duration: "6s" });
    expect(flowMotion(1000000000, speed).duration).toBe("6s");
  });
  it("uses observed negotiated speeds and inherits VLAN capacity from its parent without loops", () => {
    const config = trafficFlowConfig(), data = trafficFlowStatistics(), snapshot = trafficFlowCapabilities(100);
    expect(flowPorts(config, data, null, snapshot).map(port => port.speedMbps)).toEqual([100, 100, 100, 100]);
    snapshot.inventory.interfaces[2]!.link!.speed_mbps = 0;
    expect(flowPorts(config, data, null, snapshot).map(port => port.speedMbps)).toEqual([100, 100, null, null]);
    config.interfaces.find(link => link.kind === "vlan")!.vlan.parent = "guest20";
    expect(flowPorts(config, data, null, snapshot).at(-1)!.speedMbps).toBeNull();
    snapshot.inventory.source = "simulator";
    expect(flowPorts(config, data, null, snapshot).every(port => port.speedMbps === null)).toBe(true);
    snapshot.inventory.source = "native"; snapshot.inventory.status = "simulated";
    expect(flowPorts(config, data, null, snapshot).every(port => port.speedMbps === null)).toBe(true);
  });
  it("connects interface centers to the appliance in both responsive fan directions", () => {
    expect(flowLinkPath(1000, 0, 2, "wan", -5)).toBe("M 245 0 C 245 85, 425 65, 425 152");
    expect(flowLinkPath(1000, 0, 2, "lan", -5)).toBe("M 425 0 C 425 85, 245 65, 245 152");
    expect(flowLinkPath(320, 0, 1, "wan", 5)).toBe("M 165 0 C 165 85, 165 65, 165 152");
    const port = Number(flowLinkPath(10000, 0, 50, "lan", 0, 296).match(/^M ([\d.]+)/)?.[1]);
    expect(Math.abs(port - 5000)).toBeLessThan(296 / 2);
  });
});
