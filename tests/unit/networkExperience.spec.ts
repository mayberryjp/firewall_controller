import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFailure, request } from "@/services/api";
import { experienceHistorySchema, experienceLatestSchema, getNetworkExperience, getNetworkExperienceHistory, sumExperienceCounters } from "@/services/networkExperience";
import { experienceHistory, experienceLatest } from "../networkExperienceFixtures";

vi.mock("@/services/api", async original => ({
  ...await original<typeof import("@/services/api")>(), request: vi.fn(),
}));
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.restoreAllMocks());
describe("Network experience contract and coherent reads", () => {
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
    expect(request).toHaveBeenNthCalledWith(2, "GET", "/statistics/host-experience/latest?limit=100&cursor=opaque%3Acursor",
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
    expect(vi.mocked(request).mock.calls[2]![1]).toBe("/statistics/host-experience/latest?limit=100");
  });
  it("reduces page size only for response capacity errors and bounds repeated invalidation", async () => {
    vi.mocked(request).mockRejectedValueOnce(new ApiFailure("Response exceeds 4 MiB limit", 503)).mockResolvedValueOnce(experienceLatest());
    await getNetworkExperience();
    expect(vi.mocked(request).mock.calls[1]![1]).toBe("/statistics/host-experience/latest?limit=50");
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
