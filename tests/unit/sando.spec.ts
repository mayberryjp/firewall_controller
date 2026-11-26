import { afterEach, describe, expect, it, vi } from "vitest";
import { forceSandoSync, getSandoDevices, sandoBaseUrl, sandoStatusSchema } from "@/services/sando";
import { request } from "@/services/api";
import { sandoStatus } from "../sandoFixtures";

vi.mock("@/services/api", () => ({ request: vi.fn() }));
afterEach(() => vi.resetAllMocks());

describe("server-side Sando cache", () => {
  it.each(["hosts", "policies"] as const)("forces %s through the authenticated appliance with no body and propagates failures", async target => {
    const status = sandoStatus(), signal = new AbortController().signal;
    vi.mocked(request).mockResolvedValueOnce(status);
    expect(await forceSandoSync(target, signal)).toEqual(status);
    expect(request).toHaveBeenCalledExactlyOnceWith("POST", `/sando/${target}/sync`, sandoStatusSchema, undefined, signal);
    vi.mocked(request).mockRejectedValueOnce(new Error("Sync denied"));
    await expect(forceSandoSync(target, signal)).rejects.toThrow("Sync denied");
  });
  it("reads cached classifications, icons and threat scores from the authenticated appliance API only", async () => {
    const status = sandoStatus();
    status.hosts = [{
      addresses: ["192.0.2.20", "2001:db8::20"], host_name: "dns-name",
      classification: "Living room tablet", icon: "Tablet", threat_score: -1,
    }];
    vi.mocked(request).mockResolvedValue(status);
    const signal = new AbortController().signal;
    expect(await getSandoDevices("https://sando.example/api", signal)).toEqual([{
      ip_address: "192.0.2.20", ip6_address: "2001:db8::20",
      local_description: "Living room tablet", icon: "Tablet", threat_score: -1,
    }]);
    expect(request).toHaveBeenCalledExactlyOnceWith("GET", "/sando", sandoStatusSchema, undefined, signal);
  });
  it("rejects another source's cache and exposes worker failures rather than claiming empty success", async () => {
    const status = sandoStatus();
    vi.mocked(request).mockResolvedValue(status);
    await expect(getSandoDevices("https://other.example", new AbortController().signal)).rejects.toThrow("source changed");
    status.error = "Cache persistence failed";
    await expect(getSandoDevices("https://sando.example", new AbortController().signal)).rejects.toThrow("Cache persistence failed");
  });
  it("preserves explicit unavailable metadata and successful empty caches", async () => {
    const status = sandoStatus();
    status.hosts = [{ addresses: ["192.0.2.20"], host_name: null, classification: null, icon: null, threat_score: null }];
    vi.mocked(request).mockResolvedValue(status);
    expect(await getSandoDevices("https://sando.example", new AbortController().signal)).toEqual([{
      ip_address: "192.0.2.20", ip6_address: undefined, local_description: null, icon: null, threat_score: null,
    }]);
    status.hosts = [];
    expect(await getSandoDevices("https://sando.example", new AbortController().signal)).toEqual([]);
  });
  it("normalizes the endpoint without allowing credentials or query parameters", () => {
    expect(sandoBaseUrl(" https://sando.example/path/api/ ")).toBe("https://sando.example/path");
    expect(() => sandoBaseUrl("https://user:password@sando.example")).toThrow();
    expect(() => sandoBaseUrl("https://sando.example?token=value")).toThrow();
  });
});
