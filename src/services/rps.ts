import { z } from "zod";
import { dateVersionSchema } from "@/services/versions";

export function rpsMaskCpus(mask: string): number[] {
  if (mask.length > 2303 || !/^(?:0|[1-9a-f][0-9a-f]{0,7}(?:,[0-9a-f]{8}){0,255})$/.test(mask)) {
    throw new Error("Use canonical lowercase hexadecimal: no 0x prefix or leading zeros; subsequent words must contain eight digits.");
  }
  const cpus: number[] = [];
  mask.split(",").reverse().forEach((word, index) => {
    const bits = Number.parseInt(word, 16);
    for (let bit = 0; bit < 32; bit++) if ((bits >>> bit) & 1) cpus.push(index * 32 + bit);
  });
  return cpus;
}

export function rpsMaskForCpuCount(count: number, onlineCpus: readonly number[]): string {
  if (onlineCpus.some(cpu => !Number.isInteger(cpu) || cpu < 0 || cpu > 8191)) {
    throw new Error("Online CPU IDs must be whole numbers from 0 to 8191.");
  }
  const cpus = [...new Set(onlineCpus)].sort((left, right) => left - right);
  if (!Number.isInteger(count) || count < 0 || count > cpus.length) {
    throw new Error(`Choose a whole-number CPU count from 0 to ${cpus.length}.`);
  }
  if (count === 0) return "0";
  const words: number[] = [];
  for (const cpu of cpus.slice(0, count)) {
    const word = Math.floor(cpu / 32);
    words[word] = ((words[word] ?? 0) | (1 << (cpu % 32))) >>> 0;
  }
  return Array.from({ length: words.length }, (_, index) => words[index] ?? 0).reverse()
    .map((word, index) => index === 0 ? word.toString(16) : word.toString(16).padStart(8, "0")).join(",");
}

export function rpsTarget(target: string): { interface: string; queue: string } {
  const match = /^([a-zA-Z0-9_.-]{1,15})\/(rx-(0|[1-9]\d{0,3}))$/.exec(target);
  if (!match || ["lo", ".", ".."].includes(match[1]!) || Number(match[3]) > 4095) throw new Error("Use a managed Ethernet or WireGuard interface/rx-N queue, with canonical index 0..4095.");
  return { interface: match[1]!, queue: match[2]! };
}

const cpu = z.number().int().min(0).max(8191);
const cpuEvidence = z.object({
  status: z.enum(["available", "partial", "unavailable"]),
  data: z.array(cpu).nullable(), error: z.string().nullable(),
});
export const rpsDiagnosticsSchema = z.object({
  schema: z.literal("netcontrol-performance/v1"),
  sample: z.object({
    scope: z.enum(["host", "simulator"]), backend_scope: z.string(),
    status: z.enum(["available", "partial", "simulated"]),
    collected_at: z.string().nullable(), identity_stable: z.boolean(),
  }),
  sections: z.object({ online_cpus: cpuEvidence }),
  interfaces: z.array(z.object({
    name: z.string(), index: z.number().int().nonnegative(), mac: z.string().nullable(),
    physical: z.boolean(), managed: z.boolean(),
    rx_queues: z.array(z.object({
      name: z.string(), rps_cpus: z.string(), rps_flow_cnt: z.number().int().nonnegative().nullable().optional(),
    })).nullable(),
    errors: z.array(z.string()),
  })).nullable(),
  configured_rps: z.record(z.string()),
  configured_rfs: z.object({
    sock_flow_entries: z.number().int().nonnegative(), queues: z.record(z.number().int().nonnegative()),
  }).nullable().optional(),
  configured_offloads: z.record(z.record(z.boolean())).optional(),
  rfs: z.object({
    status: z.enum(["ready", "unavailable", "simulated"]),
    sock_flow_entries: z.number().int().nonnegative().nullable(), error: z.string().nullable(),
  }).optional(),
  tuning_available: z.boolean(),
  config_revision: dateVersionSchema,
  transaction_id: z.string().nullable(),
});
export type RpsDiagnostics = z.infer<typeof rpsDiagnosticsSchema>;
