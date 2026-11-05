import { describe, expect, it } from "vitest";
import { rpsMaskCpus, rpsMaskForCpuCount, rpsTarget, rpsDiagnosticsSchema } from "@/services/rps";
import { configSchema, stateSchema, transactionSchema } from "@/types/domain";
import { cloneConfig, differences, equalConfig, importConfig, normalize, requiredPermissions, validateConfig } from "@/services/configuration";
import { encodeJson, decodeJson } from "@/services/json";
import { config, state, transaction } from "../fixtures";
import { rpsDiagnostics, wireguardInterface, wireguardRpsDiagnostics } from "../diagnosticsFixtures";

function ethernetConfig() {
  const value = config();
  value.interfaces[0] = { ...value.interfaces[0]!, kind: "ethernet" };
  return value;
}
describe("RPS masks and configuration preservation", () => {
  it("generates canonical masks from whole-number counts using sorted unique online CPU IDs", () => {
    expect(rpsMaskForCpuCount(0, [0, 1, 2, 3])).toBe("0");
    expect(rpsMaskForCpuCount(1, [0, 1, 2, 3])).toBe("1");
    expect(rpsMaskForCpuCount(2, [0, 1, 2, 3])).toBe("3");
    expect(rpsMaskForCpuCount(3, [0, 1, 2, 3])).toBe("7");
    expect(rpsMaskForCpuCount(4, [0, 1, 2, 3])).toBe("f");
    expect(rpsMaskForCpuCount(2, [32, 2, 32, 0])).toBe("5");
    expect(rpsMaskForCpuCount(3, [32, 2, 0])).toBe("1,00000005");
    expect(rpsMaskForCpuCount(2, [32, 31])).toBe("1,80000000");
  });
  it("round-trips the maximum online CPU count and high sparse IDs without a signed-word overflow", () => {
    const all = Array.from({ length: 8192 }, (_, cpu) => cpu);
    expect(rpsMaskCpus(rpsMaskForCpuCount(all.length, all))).toEqual(all);
    expect(rpsMaskCpus(rpsMaskForCpuCount(1, [8191]))).toEqual([8191]);
  });
  it.each([-1, 1.5, 5, NaN, Infinity])("rejects unavailable or non-whole CPU count %s", count => {
    expect(() => rpsMaskForCpuCount(count, [0, 1, 2, 3])).toThrow(/whole-number CPU count/);
  });
  it("does not invent CPUs from the maximum ID or count duplicate IDs twice", () => {
    expect(() => rpsMaskForCpuCount(2, [2, 2])).toThrow();
    expect(() => rpsMaskForCpuCount(1, [])).toThrow();
    for (const cpus of [[-1], [1.5], [8192]]) expect(() => rpsMaskForCpuCount(1, cpus)).toThrow(/CPU IDs/);
  });
  it.each([
    ["0", []], ["c", [2, 3]], ["80000000", [31]], ["1,00000000", [32]], ["1,80000001,00000007", [0, 1, 2, 32, 63, 64]],
  ] as const)("decodes canonical mask %s without guessing CPUs", (mask, cpus) => {
    expect(rpsMaskCpus(mask)).toEqual(cpus);
  });
  it.each(["", "00", "A", "00000001", "0,00000001", "0x1", "1,", "1,1", "-1", "100000000", "1 ", "1".repeat(2304)])("rejects noncanonical mask %j", mask => {
    expect(() => rpsMaskCpus(mask)).toThrow();
  });
  it("accepts CPU 8191 and rejects a 257th mask word", () => {
    const mask = ["80000000", ...Array<string>(255).fill("00000000")].join(",");
    expect(rpsMaskCpus(mask)).toEqual([8191]);
    expect(() => rpsMaskCpus(`1,${mask}`)).toThrow();
  });
  it.each(["eno1/tx-0", "eno1/rx-00", "eno1/rx-4096", "../rx-0", "lo/rx-0", "eno1/rx-0/x"])("rejects invalid target %s", target => {
    expect(() => rpsTarget(target)).toThrow();
  });
  it("accepts canonical target bounds", () => {
    expect(rpsTarget("eno1/rx-4095")).toEqual({ interface: "eno1", queue: "rx-4095" });
  });
  it.each(["ethernet", "wireguard"] as const)("preserves %s RPS through state reads, imports, normalization, editable clones, transactions and revision-like configuration", kind => {
    const candidate = ethernetConfig(); candidate.kernel!.rps = { "lab0/rx-0": "c", "lab0/rx-1": "0" };
    if (kind === "wireguard") candidate.interfaces[0] = { ...wireguardInterface("lab0"), addresses: candidate.interfaces[0]!.addresses };
    expect(configSchema.parse(candidate).kernel?.rps).toEqual(candidate.kernel!.rps);
    expect(importConfig(encodeJson(candidate)).kernel?.rps).toEqual(candidate.kernel!.rps);
    expect(cloneConfig(candidate).kernel?.rps).toEqual(candidate.kernel!.rps);
    expect(normalize(candidate).kernel?.rps).toEqual(candidate.kernel!.rps);
    expect(stateSchema.parse({ ...state(), desired: candidate, observed: candidate }).desired.kernel?.rps).toEqual(candidate.kernel!.rps);
    const pending = { ...transaction(), previous: candidate, candidate };
    expect(transactionSchema.parse(decodeJson(encodeJson(pending))).candidate.kernel?.rps).toEqual(candidate.kernel!.rps);
    const baseline = cloneConfig(candidate); delete baseline.kernel!.rps;
    expect(validateConfig(candidate, undefined, baseline)).toEqual([]);
  });
  it.each(["ethernet", "wireguard"] as const)("requires interface and host permissions for %s enable, disable and restore-original changes", kind => {
    const base = ethernetConfig(), enabled = ethernetConfig(), disabled = ethernetConfig();
    if (kind === "wireguard") {
      for (const candidate of [base, enabled, disabled]) {
        candidate.interfaces[0] = { ...wireguardInterface("lab0"), addresses: candidate.interfaces[0]!.addresses };
      }
    }
    enabled.kernel!.rps = { "lab0/rx-0": "c" }; disabled.kernel!.rps = { "lab0/rx-0": "0" };
    for (const [before, after] of [[base, enabled], [enabled, disabled], [disabled, base]]) {
      expect(requiredPermissions(differences(before!, after!))).toEqual(["transactions.write", "interfaces.write", "kernel.host.write"]);
    }
    expect(equalConfig(base, { ...base, kernel: { ...base.kernel!, rps: {} } })).toBe(true);
    expect(equalConfig(enabled, disabled)).toBe(false);
    expect(equalConfig(disabled, base)).toBe(false);
  });
  it("keeps namespace and host maps read-only while permitting RPS edits", () => {
    const base = ethernetConfig(), candidate = ethernetConfig();
    candidate.kernel!.rps = { "lab0/rx-0": "c" };
    candidate.kernel!.host = { "vm.swappiness": "10" };
    expect(validateConfig(candidate, undefined, base).some(issue => issue.path === "kernel")).toBe(true);
  });
  it("rejects null maps, invalid masks, unsupported references and more than 64 queue settings", () => {
    expect(configSchema.safeParse({ ...config(), kernel: { namespace: {}, host: {}, rps: null } }).success).toBe(false);
    const candidate = ethernetConfig();
    const invalidSettings: Record<string, string>[] = [{ "lab0/rx-0": "A" }, { "missing/rx-0": "c" }, { "lab0/tx-0": "c" }];
    for (const rps of invalidSettings) {
      candidate.kernel!.rps = rps;
      expect(validateConfig(candidate).some(issue => issue.path.startsWith("kernel.rps"))).toBe(true);
    }
    candidate.kernel!.rps = { "lab0/rx-0": "c" }; candidate.interfaces[0]!.kind = "dummy";
    expect(validateConfig(candidate).some(issue => issue.path.startsWith("kernel.rps"))).toBe(true);
    candidate.interfaces[0]!.kind = "ethernet";
    candidate.kernel!.rps = Object.fromEntries(Array.from({ length: 64 }, (_, index) => [`lab0/rx-${index}`, "0"]));
    expect(validateConfig(candidate)).toEqual([]);
    candidate.kernel!.rps["lab0/rx-64"] = "0";
    expect(validateConfig(candidate).some(issue => issue.path === "kernel.rps")).toBe(true);
  });
  it("validates the consumed performance prerequisite fields without inventing unknown evidence", () => {
    expect(rpsDiagnosticsSchema.parse(rpsDiagnostics())).toEqual(rpsDiagnostics());
    const missing = rpsDiagnostics(); missing.sections.online_cpus = { status: "unavailable", data: null, error: "CPU read failed" };
    expect(rpsDiagnosticsSchema.parse(missing).sections.online_cpus.data).toBeNull();
    expect(rpsDiagnosticsSchema.safeParse({ ...missing, tuning_available: undefined }).success).toBe(false);
  });
  it("accepts WireGuard RPS without IRQ or RFS-count evidence and preserves null counts", () => {
    const data = wireguardRpsDiagnostics();
    expect(rpsDiagnosticsSchema.parse(data).interfaces!.at(-1)).toMatchObject({
      physical: false, managed: true, rx_queues: [{ name: "rx-0", rps_cpus: "0", rps_flow_cnt: null }],
    });
    expect(rpsDiagnosticsSchema.parse({
      ...data, interfaces: data.interfaces!.map(link => ({ ...link, irqs: null })),
    }).interfaces!.at(-1)!.rx_queues![0]!.rps_flow_cnt).toBeNull();
  });
  it("keeps RFS and NIC offloads physical-only even when WireGuard RPS is valid", () => {
    const candidate = ethernetConfig();
    candidate.interfaces.push(wireguardInterface());
    candidate.kernel!.rps = { "wg0/rx-0": "2" };
    candidate.kernel!.rfs = { sock_flow_entries: 1024, queues: { "wg0/rx-0": 1024 } };
    candidate.kernel!.offloads = { wg0: { "rx-gro": false } };
    const issues = validateConfig(candidate);
    expect(issues.some(issue => issue.path.startsWith("kernel.rps"))).toBe(false);
    expect(issues.some(issue => issue.path.startsWith("kernel.rfs.queues"))).toBe(true);
    expect(issues.some(issue => issue.path.startsWith("kernel.offloads"))).toBe(true);
  });
  it("preserves WireGuard RPS across rekey and requires explicit removal before deleting the tunnel", () => {
    const base = ethernetConfig(), candidate = cloneConfig(base);
    candidate.interfaces.push(wireguardInterface());
    candidate.kernel!.rps = { "wg0/rx-0": "2" };
    expect(validateConfig(candidate, undefined, base)).toEqual([]);
    const rekey = cloneConfig(candidate);
    rekey.interfaces.find(link => link.kind === "wireguard")!.wireguard.key_ref = "replacement-key";
    expect(validateConfig(rekey, undefined, candidate)).toEqual([]);
    expect(normalize(rekey).kernel!.rps).toEqual({ "wg0/rx-0": "2" });
    expect(requiredPermissions(differences(base, candidate))).toEqual(["transactions.write", "interfaces.write", "wireguard.write", "kernel.host.write"]);
    candidate.interfaces = candidate.interfaces.filter(link => link.name !== "wg0");
    expect(validateConfig(candidate).some(issue => issue.path === "kernel.rps.wg0/rx-0")).toBe(true);
    delete candidate.kernel!.rps;
    expect(validateConfig(candidate, undefined, base)).toEqual([]);
  });
});
