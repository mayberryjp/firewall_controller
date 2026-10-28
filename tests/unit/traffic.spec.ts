import { describe, expect, it } from "vitest";
import { emptyTrafficRates, trafficFrame, usableTrafficSample } from "@/services/traffic";
import { trafficStatistics } from "../fixtures";

describe("live interface traffic rates", () => {
  it("uses elapsed sample time for inbound and outbound bytes and packets and sums all interfaces", () => {
    const frame = trafficFrame(trafficStatistics(), trafficStatistics(3, 300n));
    expect(frame.time).toBe(Date.parse("2026-10-27T12:00:03.123Z"));
    expect(frame.interfaces.eth0).toEqual({ rx_bytes: 100, tx_bytes: 200, rx_packets: 300, tx_packets: 400 });
    expect(frame.interfaces.eth1).toEqual({ rx_bytes: 200, tx_bytes: 400, rx_packets: 600, tx_packets: 800 });
    expect(frame.total).toEqual({ rx_bytes: 300, tx_bytes: 600, rx_packets: 900, tx_packets: 1200 });
  });
  it("subtracts 64-bit counters before converting to chart numbers", () => {
    const before = trafficStatistics(), after = trafficStatistics(3);
    before.interfaces[0]!.counters!.rx_bytes = "18446744073709551000";
    after.interfaces[0]!.counters!.rx_bytes = "18446744073709551003";
    expect(trafficFrame(before, after).interfaces.eth0!.rx_bytes).toBe(1);
  });
  it("shows measured idle traffic as zero but never invents a rate from one sample", () => {
    expect(trafficFrame(null, trafficStatistics()).total).toEqual(emptyTrafficRates());
    expect(trafficFrame(trafficStatistics(), trafficStatistics(3)).total).toEqual({ rx_bytes: 0, tx_bytes: 0, rx_packets: 0, tx_packets: 0 });
  });
  it("continues calculating rates when each collection start timestamp changes", () => {
    const before = trafficStatistics(), after = trafficStatistics(3, 300n);
    expect(before.sample.started_at).not.toBe(after.sample.started_at);
    expect(trafficFrame(before, after).total).toEqual({ rx_bytes: 300, tx_bytes: 600, rx_packets: 900, tx_packets: 1200 });
  });
  it.each(["scope", "identity", "same-time", "earlier-time", "unavailable", "simulated", "negative", "missing", "reset"] as const)(
    "leaves gaps for %s instead of reporting spikes or fabricated zeroes", change => {
      const before = trafficStatistics(), after = trafficStatistics(3, 300n);
      switch (change) {
        case "scope": after.sample.scope = "another-device"; break;
        case "identity": after.interfaces[0]!.index = 99; break;
        case "same-time": after.sample.collected_at = before.sample.collected_at; break;
        case "earlier-time": after.sample.collected_at = "2026-10-26T12:00:00Z"; break;
        case "unavailable": after.interfaces[0]!.status = "unavailable"; break;
        case "simulated": after.sample.status = "simulated"; break;
        case "negative": after.interfaces[0]!.counters!.rx_bytes = "-1"; break;
        case "missing": delete after.interfaces[0]!.counters!.rx_bytes; break;
        case "reset": after.interfaces[0]!.counters!.rx_bytes = "5"; break;
      }
      const frame = trafficFrame(before, after);
      expect(frame.interfaces.eth0!.rx_bytes).toBeNull();
      expect(frame.total.rx_bytes).toBeNull();
    },
  );
  it("preserves available per-interface rates while leaving incomplete aggregate series unknown", () => {
    const before = trafficStatistics(), after = trafficStatistics(3, 300n);
    after.sample.status = "partial";
    after.interfaces[1]!.error = "Counters unavailable";
    expect(trafficFrame(before, after).interfaces.eth0!.rx_bytes).toBe(100);
    expect(trafficFrame(before, after).total).toEqual(emptyTrafficRates());
  });
  it.each(["added", "removed"] as const)("breaks aggregate continuity when an interface is %s", change => {
    const before = trafficStatistics(), after = trafficStatistics(3, 300n);
    if (change === "added") before.interfaces.pop();
    else after.interfaces.pop();
    const frame = trafficFrame(before, after);
    expect(frame.interfaces.eth0!.rx_bytes).toBe(100);
    expect(frame.total).toEqual(emptyTrafficRates());
  });
  it("rejects invalid sample timestamps and unsupported sample states", () => {
    const sample = trafficStatistics();
    sample.sample.collected_at = "invalid";
    expect(usableTrafficSample(sample)).toBe(false);
    sample.sample.collected_at = trafficStatistics().sample.collected_at;
    sample.sample.status = "unavailable";
    expect(usableTrafficSample(sample)).toBe(false);
  });
});
