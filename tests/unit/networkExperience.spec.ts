import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFailure, request } from "@/services/api";
import { experienceHistorySchema, experienceLatestSchema, experienceSummarySchema, experienceNumber, experienceRate, getNetworkExperience, getNetworkExperienceHistory, getNetworkExperienceSummary, sumExperienceCounters } from "@/services/networkExperience";
import { experienceHistory, experienceLatest, experienceSummary } from "../networkExperienceFixtures";

vi.mock("@/services/api", async original => ({
  ...await original<typeof import("@/services/api")>(), request: vi.fn(),
}));
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.restoreAllMocks());
describe("Network experience contract and coherent reads", () => {
  it("reads exactly one 256-host summary page without following cursors or requesting latest/history", async () => {
    const data = experienceSummary(), signal = new AbortController().signal;
    data.next_cursor = "more-hosts"; data.eligible_hosts = 100;
    vi.mocked(request).mockResolvedValue(data);
    expect(await getNetworkExperienceSummary(signal)).toBe(data);
    expect(request).toHaveBeenCalledExactlyOnceWith("GET", "/statistics/host-experience/summary?limit=256",
      experienceSummarySchema, undefined, signal);
  });
  it("preserves above-u64 summary totals, zero, missing observations and explicitly unavailable quantiles", () => {
    const data = experienceSummary(), value = data.hosts[0]!.summary;
    value.firewall.dropped_sent_packets.total = "18446744073709551616";
    value.traffic.sent_bytes.total = null;
    expect(experienceSummarySchema.parse(data)).toEqual(data);
    expect(value.tcp.retransmission_observations_sent.total).toBe("0");
    expect(experienceSummarySchema.safeParse({
      ...data, hosts: [{ ...data.hosts[0]!, summary: { ...value, tcp: { ...value.tcp, rtt_remote: { ...value.tcp.rtt_remote, p95_ms: -1 } } } }],
    }).success).toBe(false);
    const hosts = Array.from({ length: 256 }, (_, index) => ({ ...data.hosts[0]!, ip_address: `192.0.2.${index}` }));
    expect(experienceSummarySchema.safeParse({ ...data, hosts }).success).toBe(true);
    expect(experienceSummarySchema.safeParse({ ...data, hosts: [...hosts, { ...data.hosts[0]!, ip_address: "192.0.3.1" }] }).success).toBe(false);
    expect(experienceSummarySchema.safeParse({ ...data, hosts: [data.hosts[0], data.hosts[0]] }).success).toBe(false);
  });
  it.each([429, 503])("surfaces summary HTTP %s without paging, size reductions or live fallback", async status => {
    vi.mocked(request).mockRejectedValue(new ApiFailure("Summary unavailable", status));
    await expect(getNetworkExperienceSummary()).rejects.toMatchObject({ status });
    expect(request).toHaveBeenCalledOnce();
  });
  it("accepts pooled timing estimates, nullable reasons and exact timing-subset counts", () => {
    const data = experienceSummary(), value = data.hosts[0]!.summary;
    for (const timing of [value.dns, value.tcp.rtt_host, value.tcp.rtt_remote]) {
      timing.timing_samples = "9007199254740993";
      timing.timing_observed_slots = 2; timing.timing_missing_slots = 1;
    }
    value.tcp.rtt_remote.p50_ms = 0; value.tcp.rtt_remote.p95_ms = 12.5;
    value.tcp.rtt_remote.percentile_unavailable_reason = null;
    value.dns.response_time_p50_ms = 12; value.dns.response_time_p95_ms = 20;
    value.dns.response_time_variation_mean_ms = 3; value.dns.variation_pairs = "9";
    value.dns.timing_unavailable_reason = null;
    expect(experienceSummarySchema.parse(data)).toEqual(data);
  });
  it("preserves exact current connection counts, fractional averages and explicit missing/stale status", () => {
    const data = experienceSummary(), connections = data.hosts[0]!.summary.connections;
    connections.current.total = "9007199254740993";
    connections.current.status = "stale"; connections.current.age_ms = 30001;
    connections.average.total = 20.125;
    expect(experienceSummarySchema.parse(data)).toEqual(data);
    connections.current = {
      status: "unavailable", error: "No matching current host attachment", observed_at: null,
      measurement_duration_ms: null, age_ms: null, total: null, tcp_established: null, unreplied: null,
    };
    connections.average.unreplied = 0;
    expect(experienceSummarySchema.parse(data)).toEqual(data);
    connections.average.total = null;
    expect(experienceSummarySchema.parse(data).hosts[0]!.summary.connections.average.total).toBeNull();
  });
  it("formats measurements with exactly two decimals without changing their precision", () => {
    expect(experienceNumber(0)).toBe("0.00");
    expect(experienceNumber(12.3456)).toBe("12.35");
    expect(experienceNumber(100)).toBe("100.00");
    expect(experienceNumber(12000, true)).toBe("12.00K");
    expect(experienceNumber(null)).toBe("Unavailable");
    expect(experienceRate(0)).toBe("0.00 bps");
    expect(experienceRate(400000)).toBe("400.00 Kbps");
    expect(experienceRate(1234567)).toBe("1.23 Mbps");
    expect(experienceRate(undefined)).toBe("Unavailable");
  });
  it("preserves exact counters, nulls and original-case descriptions", () => {
    const data = experienceLatest();
    data.hosts[0]!.retained_usage.sent_bytes = "9007199254740993";
    data.hosts[0]!.sample!.traffic.sent_bytes = null;
    expect(experienceLatestSchema.parse(data)).toEqual(data);
    expect(sumExperienceCounters("9007199254740993", "2")).toBe("9007199254740995");
    expect(sumExperienceCounters(null, "2")).toBeNull();
    expect(experienceHistorySchema.parse(experienceHistory())).toEqual(experienceHistory());
  });
  it("does not accept fabricated zero samples in missing history slots", () => {
    const history = experienceHistory();
    history.samples[0]!.sample = history.samples.at(-1)!.sample;
    expect(experienceHistorySchema.safeParse(history).success).toBe(false);
  });
  it("requires the complete 360-slot hour and an accurate observed count", () => {
    const history = experienceHistory();
    expect(experienceHistorySchema.safeParse({ ...history, samples: history.samples.slice(1) }).success).toBe(false);
    expect(experienceHistorySchema.safeParse({ ...history, returned_samples: 2 }).success).toBe(false);
  });
  it("completes all pages before returning one snapshot", async () => {
    const first = experienceLatest(), second = experienceLatest();
    first.next_cursor = "opaque:cursor";
    second.hosts[0]!.ip_address = "2001:db8::20"; second.hosts[0]!.address_family = "ipv6";
    vi.mocked(request).mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const signal = new AbortController().signal;
    const result = await getNetworkExperience(signal);
    expect(result.hosts.map(host => host.ip_address)).toEqual(["192.0.2.20", "2001:db8::20"]);
    expect(request).toHaveBeenNthCalledWith(2, "GET", "/statistics/host-experience/latest?limit=256&cursor=opaque%3Acursor",
      experienceLatestSchema, undefined, signal);
  });
  it("includes elapsed paging time in the snapshot age instead of presenting it as fresh", async () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(1000).mockReturnValueOnce(35000);
    vi.mocked(request).mockResolvedValueOnce(experienceLatest());
    expect((await getNetworkExperience()).age_ms).toBe(34000);
  });
  it.each(["conflict", "changed-collection"])("discards incomplete pages and restarts after %s", async kind => {
    const first = { ...experienceLatest(), next_cursor: "old" };
    vi.mocked(request).mockResolvedValueOnce(first);
    if (kind === "conflict") vi.mocked(request).mockRejectedValueOnce(new ApiFailure("Expired cursor", 409));
    else vi.mocked(request).mockResolvedValueOnce({ ...experienceLatest(), collection_id: "collection-2" });
    vi.mocked(request).mockResolvedValueOnce(experienceLatest());
    const result = await getNetworkExperience();
    expect(result.hosts).toHaveLength(1);
    expect(vi.mocked(request).mock.calls[2]![1]).toBe("/statistics/host-experience/latest?limit=256");
  });
  it("reduces page size only for response capacity errors and bounds repeated invalidation", async () => {
    vi.mocked(request).mockRejectedValueOnce(new ApiFailure("Response exceeds 4 MiB limit", 503)).mockResolvedValueOnce(experienceLatest());
    await getNetworkExperience();
    expect(vi.mocked(request).mock.calls[1]![1]).toBe("/statistics/host-experience/latest?limit=128");
    vi.mocked(request).mockReset().mockRejectedValue(new ApiFailure("Expired", 409));
    await expect(getNetworkExperience()).rejects.toMatchObject({ status: 409 });
    expect(request).toHaveBeenCalledTimes(4);
    vi.mocked(request).mockReset().mockRejectedValue(new ApiFailure("Storage corrupt", 503));
    await expect(getNetworkExperience()).rejects.toMatchObject({ status: 503 });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("refuses duplicate hosts and looping cursors rather than silently truncating", async () => {
    vi.mocked(request).mockResolvedValue({ ...experienceLatest(), next_cursor: "same" });
    await expect(getNetworkExperience()).rejects.toThrow("duplicate host");
  });
  it("encodes selected IPv6 history and rejects a different returned address", async () => {
    vi.mocked(request).mockResolvedValue(experienceHistory());
    await getNetworkExperienceHistory("2001:db8::20");
    const call = vi.mocked(request).mock.calls[0]!;
    expect(call[1]).toBe("/statistics/host-experience/history?address=2001%3Adb8%3A%3A20");
    expect(call[2].safeParse(experienceHistory()).success).toBe(false);
  });
});
