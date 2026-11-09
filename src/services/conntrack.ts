import { z } from "zod";
import type { KernelConfig } from "@/types/domain";

export const kernelTunablesCatalogSchema = z.array(z.object({
  name: z.string(), scope: z.enum(["host", "namespace"]), kind: z.string(),
  min: z.number().int().safe(), max: z.number().int().safe(), count: z.number().int().nonnegative(),
  description: z.string(),
}).refine(value => value.min <= value.max, "Invalid tunable bounds")).superRefine((entries, context) => {
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = `${entry.scope}/${entry.name}`;
    if (seen.has(key)) context.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate catalog entry ${key}` });
    seen.add(key);
  }
});
export type KernelTunable = z.infer<typeof kernelTunablesCatalogSchema>[number];
const kernelMapsSchema = z.object({ host: z.record(z.string()), namespace: z.record(z.string()) });
export const kernelTunablesSchema = z.object({
  desired: kernelMapsSchema, configured: kernelMapsSchema, effective: kernelMapsSchema,
  observed: kernelMapsSchema, captured_original: kernelMapsSchema, drift: z.boolean(),
});
export type KernelTunables = z.infer<typeof kernelTunablesSchema>;

export function isConntrackControl(name: string): boolean {
  return /^net\.netfilter\.nf_conntrack_(max|tcp_timeout_[a-z_]+|udp_timeout(?:_stream)?)$/.test(name);
}
export function conntrackControls(catalog: readonly KernelTunable[]): KernelTunable[] {
  return catalog.filter(entry => isConntrackControl(entry.name) && entry.kind === "integer" && entry.count === 1);
}
export function conntrackLabel(name: string): string {
  const suffix = name.replace("net.netfilter.nf_conntrack_", "");
  if (suffix === "max") return "Maximum connections";
  if (suffix === "udp_timeout") return "UDP unreplied timeout";
  if (suffix === "udp_timeout_stream") return "UDP stream timeout";
  return suffix.replace("tcp_timeout_", "TCP ").replaceAll("_", " ") + " timeout";
}
export function conntrackUnit(name: string): string { return name.endsWith("_max") ? "entries" : "seconds"; }
export function conntrackValueError(value: unknown, entry: KernelTunable): string {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) return "Use a canonical decimal string without signs, whitespace or leading zeros.";
  const number = BigInt(value);
  return number < BigInt(entry.min) || number > BigInt(entry.max)
    ? `Enter ${entry.min}..${entry.max} ${conntrackUnit(entry.name)}.` : "";
}
export function conntrackChanged(before: KernelConfig | undefined, after: KernelConfig | undefined): boolean {
  return (["host", "namespace"] as const).some(scope =>
    [...new Set([...Object.keys(before?.[scope] ?? {}), ...Object.keys(after?.[scope] ?? {})])]
      .some(name => isConntrackControl(name) && before?.[scope][name] !== after?.[scope][name]));
}
export function conntrackPreserved(before: KernelConfig | undefined, after: KernelConfig | undefined): boolean {
  return !conntrackChanged(before, after);
}
