import { describe, expect, it } from "vitest";
import { flowCount, nicOffloadFeatures } from "@/services/tuning";
import { configSchema, revisionDetailSchema, stateSchema, transactionSchema } from "@/types/domain";
import { cloneConfig, differences, equalConfig, importConfig, normalize, requiredPermissions, validateConfig } from "@/services/configuration";
import { decodeJson, encodeJson } from "@/services/json";
import { config, state, transaction } from "../fixtures";

function candidate() {
  const value = config();
  value.interfaces[0] = { ...value.interfaces[0]!, kind: "ethernet" };
  value.kernel!.rps = { "lab0/rx-0": "c" };
  return value;
}
describe("RFS and NIC offload configuration", () => {
  it.each([0, 1, 2, 1024, 1048576])("accepts exact RFS count %s", value => {
    expect(flowCount(value)).toBe(value);
    expect(flowCount(String(value))).toBe(value);
  });
  it.each(["", " ", "1.5", "1e3", -1, 1.5, 3, 1048577, 2097152, NaN, Infinity])("rejects invalid RFS count %s", value => {
    expect(() => flowCount(value)).toThrow(/zero or a power of two/);
  });
  it("preserves desired tuning through reads, cloning, normalization, imports, revisions and transactions", () => {
    const value = candidate();
    value.kernel!.rfs = { sock_flow_entries: 4096, queues: { "lab0/rx-0": 1024 } };
    value.kernel!.offloads = { lab0: { "rx-checksum": true, "rx-lro": false } };
    const saved = state(), pending = transaction();
    for (const result of [
      configSchema.parse(value), cloneConfig(value), normalize(value), importConfig(encodeJson(value)),
      stateSchema.parse({ ...saved, desired: value, observed: value }).desired,
      transactionSchema.parse(decodeJson(encodeJson({ ...pending, previous: value, candidate: value }))).candidate,
      revisionDetailSchema.parse({
        revision: saved.revision, current: true, transaction_id: pending.id, submitted_at: null,
        committed_at: null, submitted_by: "test", committed_by: "test", description: "tuning", config: value,
      }).config,
    ]) expect(result.kernel).toEqual(value.kernel);
    expect(validateConfig(value, undefined, candidate())).toEqual([]);
    expect(configSchema.safeParse({ ...value, kernel: { ...value.kernel, offload_requested: {} } }).success).toBe(false);
    expect(configSchema.safeParse({ ...value, kernel: { ...value.kernel, offloads: null } }).success).toBe(false);
    expect(configSchema.safeParse({ ...value, kernel: { ...value.kernel, rfs: { ...value.kernel!.rfs, automatic: true } } }).success).toBe(false);
  });
  it("distinguishes explicit zero/false ownership from release, normalizing only unmanaged values", () => {
    const base = candidate(), zero = candidate(), off = candidate();
    zero.kernel!.rfs = { sock_flow_entries: 0, queues: { "lab0/rx-0": 0 } };
    off.kernel!.offloads = { lab0: { "rx-checksum": false } };
    expect(equalConfig(base, zero)).toBe(false);
    expect(equalConfig(base, off)).toBe(false);
    expect(equalConfig(base, { ...base, kernel: { ...base.kernel!, rfs: null, offloads: {} } })).toBe(true);
    for (const [before, after] of [[base, zero], [zero, base], [base, off], [off, base]]) {
      expect(requiredPermissions(differences(before!, after!))).toEqual(["transactions.write", "interfaces.write", "kernel.host.write"]);
    }
  });
  it("checks queue budgets, exact bounds, managed Ethernet targets and explicit nonzero RPS dependencies", () => {
    const value = candidate();
    value.kernel!.rfs = { sock_flow_entries: 1048576, queues: { "lab0/rx-0": 1048576 } };
    expect(validateConfig(value)).toEqual([]);
    value.kernel!.rfs.queues["lab0/rx-1"] = 1;
    expect(validateConfig(value).map(issue => issue.message).join(" ")).toMatch(/budget/);
    value.kernel!.rfs = { sock_flow_entries: 0, queues: Object.fromEntries(Array.from({ length: 64 }, (_, n) => [`lab0/rx-${n}`, 0])) };
    expect(validateConfig(value)).toEqual([]);
    value.kernel!.rfs.queues["lab0/rx-64"] = 0;
    expect(validateConfig(value).some(issue => issue.message.includes("64"))).toBe(true);
    for (const [target, count] of [["lab0/rx-00", 0], ["missing/rx-0", 0], ["lab0/rx-0", 3], ["lab0/rx-1", 1]] as const) {
      value.kernel!.rfs = { sock_flow_entries: 1024, queues: { [target]: count } };
      expect(validateConfig(value).some(issue => issue.path.startsWith("kernel.rfs"))).toBe(true);
    }
    value.kernel!.rfs = { sock_flow_entries: 1024, queues: { "lab0/rx-0": 1 } };
    value.kernel!.rps = { "lab0/rx-0": "0" };
    expect(validateConfig(value).some(issue => issue.message.includes("nonzero RPS"))).toBe(true);
    value.kernel!.rfs.queues["lab0/rx-0"] = 0;
    expect(validateConfig(value)).toEqual([]);
    value.interfaces[0]!.kind = "dummy";
    expect(validateConfig(value).some(issue => issue.path.startsWith("kernel.rfs"))).toBe(true);
  });
  it("accepts only exact allowlisted booleans, makes LRO disable-only and enforces the 32-NIC limit", () => {
    const value = candidate();
    value.kernel!.offloads = { lab0: Object.fromEntries(nicOffloadFeatures.map(feature => [feature, false])) };
    expect(validateConfig(value)).toEqual([]);
    const invalid: Record<string, boolean>[] = [{ "rx-lro": true }, { gro: true }, { "ethtool:rx-checksum": true }, {}];
    for (const features of invalid) {
      value.kernel!.offloads = { lab0: features };
      expect(validateConfig(value).some(issue => issue.path.startsWith("kernel.offloads"))).toBe(true);
    }
    value.kernel!.offloads = { missing: { "rx-checksum": true } };
    expect(validateConfig(value).some(issue => issue.message.includes("managed physical"))).toBe(true);
    value.kernel!.offloads = {};
    for (let n = 0; n < 32; n++) {
      value.interfaces.push({ ...value.interfaces[0]!, name: `eth${n}`, addresses: [] });
      value.kernel!.offloads[`eth${n}`] = { "rx-checksum": true };
    }
    expect(validateConfig(value).some(issue => issue.path.startsWith("kernel.offloads"))).toBe(false);
    value.kernel!.offloads.lab0 = { "rx-checksum": true };
    expect(validateConfig(value).some(issue => issue.message.includes("32 NIC"))).toBe(true);
  });
  it("links tuning validation to the dedicated editors and preserves raw-editor access to RFS", () => {
    const value = candidate();
    value.kernel!.rps = { "missing/rx-0": "1" };
    value.kernel!.offloads = { lab0: { "rx-lro": true } };
    value.kernel!.rfs = { sock_flow_entries: 3, queues: {} };
    const issues = validateConfig(value);
    expect(issues.filter(issue => issue.path.startsWith("kernel.rps")).map(issue => issue.page)).toEqual(["/diagnostics/rps"]);
    expect(issues.filter(issue => issue.path.startsWith("kernel.offloads")).map(issue => issue.page)).toEqual(["/diagnostics/nic-offloads"]);
    expect(issues.filter(issue => issue.path.startsWith("kernel.rfs")).map(issue => issue.page)).toEqual(["/config/editor"]);
  });
});
