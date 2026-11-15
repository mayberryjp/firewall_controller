import { describe, expect, it } from "vitest";
import { formatHostMetric, hostChartValue, hostFindings, hostHistoryPoints, latestHostObservation } from "@/services/hostExperience";
import { experienceHistory, experienceSample } from "../networkExperienceFixtures";

describe("Host replay evidence", () => {
  it("pads measurements while keeping counts whole and preserving the shared byte-format default", async () => {
    const { formatBytes } = await import("@/services/hostHealth");
    const sample = experienceSample();
    sample.tcp.advertised_window_min_bytes_host = 1000;
    expect(formatHostMetric(sample, "host_min_window")).toBe("1.00 KB");
    expect(formatBytes("1000")).toBe("1 KB");
    expect(formatHostMetric(sample, "download")).toBe("400.00 Kbps");
    expect(formatHostMetric(sample, "dns_p95")).toBe("12.00 ms");
    expect(formatHostMetric(sample, "connections")).toBe("3");
  });
  it("retains exact counters while excluding unsafe chart values and unavailable measurements", () => {
    const sample = experienceSample();
    sample.connections.total = "9007199254740993";
    expect(formatHostMetric(sample, "connections")).toBe("9007199254740993");
    expect(hostChartValue(sample, "connections")).toBeNull();
    sample.tcp.rtt_remote.p95_ms = 12.345;
    expect(formatHostMetric(sample, "remote_p95")).toBe("12.35 ms");
    expect(hostChartValue(sample, "remote_p95")).toBe(12.345);
    sample.tcp.status = "unavailable";
    expect(formatHostMetric(sample, "remote_p95")).toBe("Unavailable");
    expect(hostChartValue(sample, "remote_p95")).toBeNull();
    expect(formatHostMetric(null, "download")).toBe("Unavailable");
  });
  it("preserves missing intervals and clock order, inserting a gap across network or epoch changes", () => {
    const history = experienceHistory(), first = structuredClone(history.samples[359]!);
    history.samples[357] = first;
    const last = history.samples[359]!;
    last.sample!.observation_epoch = "new-epoch";
    last.start_at = last.sample!.start_at = first.end_at;
    last.end_at = last.sample!.end_at = "2026-11-14T00:24:50.987654Z";
    expect(hostHistoryPoints(history).slice(-3).map(point => point.sample !== null)).toEqual([true, false, true]);
    expect(hostHistoryPoints(history).at(-1)!.at).toBe(last.end_at);
    history.samples[358] = structuredClone(first);
    history.samples[358]!.sample!.interface!.index = 30;
    history.samples[358]!.start_at = history.samples[358]!.sample!.start_at = first.end_at;
    expect(hostHistoryPoints(history).some(point => point.slotIndex === null)).toBe(true);
    expect(latestHostObservation(history)).toBe(359);
    history.samples[359] = { ...last, status: "missing", sample: null };
    expect(latestHostObservation(history)).toBe(358);
  });
  it("highlights DNS failures, timing and receive pressure without treating managed policy drops as an impairment", () => {
    const sample = experienceSample();
    expect(hostFindings(sample).find(finding => finding.label === "Managed Firewall Drops")!.color).toBe("info");
    sample.dns.servfail_responses = "2";
    sample.dns.response_time_p95_ms = 500;
    sample.tcp.zero_window_observations_host = "3";
    expect(hostFindings(sample).map(finding => finding.label)).toEqual(expect.arrayContaining([
      "DNS SERVFAIL Responses", "Elevated DNS Response", "Host Receive Pressure",
    ]));
    sample.dns.status = "not_observed";
    expect(hostFindings(sample).some(finding => finding.label.startsWith("DNS SERVFAIL") || finding.label === "Elevated DNS Response")).toBe(false);
    expect(hostFindings(null)).toEqual([]);
  });
});
