import { describe, expect, it } from "vitest";
import { conntrackControls, conntrackValueError, kernelTunablesCatalogSchema, kernelTunablesSchema } from "@/services/conntrack";
import { cloneConfig, validateConfig, differences, requiredPermissions } from "@/services/configuration";
import { configSchema } from "@/types/domain";
import { config } from "../fixtures";
import { conntrackCatalog, conntrackSnapshot } from "../conntrackFixtures";

describe("conntrack catalog and validation", () => {
  it("accepts all nine catalog entries and derives supported controls without exposing read-only or relaxation keys", () => {
    const catalog = conntrackCatalog();
    expect(kernelTunablesCatalogSchema.parse(catalog)).toEqual(catalog);
    expect(conntrackControls(catalog)).toHaveLength(9);
    for (const suffix of ["count", "buckets", "tcp_loose", "tcp_be_liberal"]) {
      expect(conntrackControls([{ ...catalog[0]!, name: `net.netfilter.nf_conntrack_${suffix}` }])).toEqual([]);
    }
    expect(conntrackControls([{ ...catalog[0]!, count: 2 }])).toEqual([]);
    expect(kernelTunablesCatalogSchema.safeParse([catalog[0], catalog[0]]).success).toBe(false);
    expect(kernelTunablesCatalogSchema.safeParse([{ ...catalog[0], min: 5, max: 4 }]).success).toBe(false);
  });
  it.each(conntrackCatalog())("uses both catalog boundaries and the exact scope for $name", entry => {
    const before = config(), candidate = cloneConfig(before);
    candidate.kernel ??= { host: {}, namespace: {} };
    for (const value of [String(entry.min), String(entry.max)]) {
      candidate.kernel[entry.scope][entry.name] = value;
      expect(validateConfig(candidate, [], before, conntrackCatalog()).filter(issue => issue.path.startsWith("kernel."))).toEqual([]);
    }
    for (const value of [String(entry.min - 1), String(entry.max + 1), "0", "01", "+1", "-1", " 1", "1 ", "1 2", "1.0", "1e3", "999999999999999999999"]) {
      expect(conntrackValueError(value, entry)).not.toBe("");
    }
    candidate.kernel = cloneConfig(before).kernel!;
    candidate.kernel[entry.scope === "host" ? "namespace" : "host"][entry.name] = String(entry.min);
    expect(validateConfig(candidate, [], before, conntrackCatalog()).some(issue => issue.message.includes("key and scope"))).toBe(true);
  });
  it("retains string serialization and rejects numbers and nulls", () => {
    const candidate = config();
    for (const value of [1024, null]) {
      expect(configSchema.safeParse({ ...candidate, kernel: { host: { "net.netfilter.nf_conntrack_max": value }, namespace: {} } }).success).toBe(false);
      expect(conntrackValueError(value, conntrackCatalog()[0]!)).not.toBe("");
    }
  });
  it("uses fetched bounds, gates unsupported changes, permits removal and preserves unrelated tunables", () => {
    const before = config(), entry = conntrackCatalog()[0]!;
    before.kernel = { host: { "net.core.rmem_max": "65536" }, namespace: {} };
    const candidate = cloneConfig(before);
    candidate.kernel!.host[entry.name] = "2048";
    expect(validateConfig(candidate, [], before).some(issue => issue.message.includes("supporting backend catalog"))).toBe(true);
    expect(validateConfig(candidate, [], before, [{ ...entry, min: 4096 }]).some(issue => issue.message.includes("4096"))).toBe(true);
    expect(validateConfig(candidate, [], before, conntrackCatalog()).filter(issue => issue.path.startsWith("kernel."))).toEqual([]);
    candidate.kernel!.host["net.core.rmem_max"] = "131072";
    expect(validateConfig(candidate, [], before, conntrackCatalog()).some(issue => issue.message.includes("preserved unchanged"))).toBe(true);
    const removed = cloneConfig(before);
    expect(validateConfig(removed, [], { ...before, kernel: { ...before.kernel!, host: { ...before.kernel!.host, [entry.name]: "2048" } } }, conntrackCatalog())
      .filter(issue => issue.path.startsWith("kernel."))).toEqual([]);
  });
  it("requires separate host/namespace write permissions for additions and removals", () => {
    const before = config(), candidate = cloneConfig(before), catalog = conntrackCatalog();
    candidate.kernel!.host[catalog[0]!.name] = "2048";
    expect(requiredPermissions(differences(before, candidate))).toEqual(["transactions.write", "kernel.host.write"]);
    candidate.kernel!.namespace[catalog[1]!.name] = "60";
    expect(requiredPermissions(differences(before, candidate))).toEqual(["transactions.write", "kernel.namespace.write", "kernel.host.write"]);
    expect(requiredPermissions(differences(candidate, before))).toEqual(["transactions.write", "kernel.namespace.write", "kernel.host.write"]);
  });
  it("retains unavailable maps and raw unsupported observations without inventing or clamping defaults", () => {
    const sample = conntrackSnapshot();
    sample.observed.host["net.netfilter.nf_conntrack_max"] = "999999999";
    expect(kernelTunablesSchema.parse(sample)).toEqual(sample);
    expect(sample.captured_original.host).toEqual({});
  });
});
