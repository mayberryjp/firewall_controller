import { z } from "zod";
import { rpsMaskCpus, rpsTarget } from "@/services/rps";

export const nicOffloadFeatures = [
  "rx-checksum", "tx-checksum-ipv4", "tx-checksum-ip-generic", "tx-checksum-ipv6",
  "tx-scatter-gather", "tx-scatter-gather-fraglist", "tx-tcp-segmentation",
  "tx-tcp6-segmentation", "tx-tcp-ecn-segmentation", "tx-tcp-mangleid-segmentation",
  "tx-generic-segmentation", "tx-gso-partial", "rx-gro", "rx-gro-hw",
  "rx-udp-gro-forwarding", "rx-lro", "rx-vlan-hw-parse", "tx-vlan-hw-insert",
  "rx-vlan-stag-hw-parse", "tx-vlan-stag-hw-insert",
] as const;
export const rfsConfigSchema = z.object({
  sock_flow_entries: z.number().int().nonnegative(),
  queues: z.record(z.number().int().nonnegative()),
}).strict();
export const offloadsSchema = z.record(z.record(z.boolean()));

export function flowCount(value: string | number): number {
  const count = typeof value === "number" ? value : /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(count) || count < 0 || count > 1048576 || (count !== 0 && (count & (count - 1)) !== 0)) {
    throw new Error("RFS entries must be zero or a power of two up to 1048576.");
  }
  return count;
}

export type TuningSettings = {
  rps?: Record<string, string>;
  rfs?: z.infer<typeof rfsConfigSchema> | null;
  offloads?: z.infer<typeof offloadsSchema>;
};
export const tuningSettings = (kernel?: TuningSettings) => ({
  rps: kernel?.rps ?? {}, rfs: kernel?.rfs ?? null, offloads: kernel?.offloads ?? {},
});

export function validateTuning(kernel: TuningSettings | undefined, ethernet: Set<string>) {
  const issues: { path: string; message: string }[] = [];
  const check = (path: string, operation: () => void) => {
    try { operation(); } catch (error) {
      issues.push({ path, message: error instanceof Error ? error.message : String(error) });
    }
  };
  const targetInterface = (target: string) => {
    const { interface: name } = rpsTarget(target);
    if (!ethernet.has(name)) throw new Error("Tuning requires a managed physical Ethernet interface, not a VLAN, tunnel or dummy interface.");
  };
  const rfs = kernel?.rfs;
  if (rfs) {
    check("kernel.rfs.sock_flow_entries", () => { flowCount(rfs.sock_flow_entries); });
    if (Object.keys(rfs.queues).length > 64) issues.push({ path: "kernel.rfs.queues", message: "At most 64 RFS queue settings." });
    for (const [target, count] of Object.entries(rfs.queues)) {
      check(`kernel.rfs.queues.${target}`, () => {
        targetInterface(target); flowCount(count);
        if (count > 0 && !rpsMaskCpus(kernel?.rps?.[target] ?? "0").length) {
          throw new Error("Positive RFS entries require an explicitly configured nonzero RPS mask on the same queue.");
        }
      });
    }
    if (Object.values(rfs.queues).reduce((sum, count) => sum + count, 0) > rfs.sock_flow_entries) {
      issues.push({ path: "kernel.rfs.queues", message: "RFS queue entries exceed the global sock_flow_entries budget." });
    }
  }
  const offloads = Object.entries(kernel?.offloads ?? {});
  if (offloads.length > 32) issues.push({ path: "kernel.offloads", message: "At most 32 NIC offload interfaces." });
  for (const [name, features] of offloads) {
    check(`kernel.offloads.${name}`, () => {
      if (!ethernet.has(name)) throw new Error("Offloads require a managed physical Ethernet interface.");
      if (!Object.keys(features).length) throw new Error("An offload interface must have at least one configured feature.");
    });
    for (const [feature, enabled] of Object.entries(features)) {
      check(`kernel.offloads.${name}.${feature}`, () => {
        if (!nicOffloadFeatures.some(allowed => allowed === feature)) throw new Error("Use an exact configurable Linux offload feature name.");
        if (typeof enabled !== "boolean") throw new Error("Offload settings must be booleans.");
        if (feature === "rx-lro" && enabled) throw new Error("LRO can only be disabled on a forwarding firewall.");
      });
    }
  }
  return issues;
}
