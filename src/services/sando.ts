import { z } from "zod";
import { request } from "@/services/api";
import { sandoSourceUrlSchema } from "@/services/sandoState";

const syncSchema = z.object({
  enabled: z.boolean(),
  state: z.enum(["disabled", "pending", "syncing", "succeeded", "error"]),
  sync_interval_seconds: z.number().int().positive(),
  source_url: z.union([z.literal(""), sandoSourceUrlSchema]),
  last_attempt_at: z.string().nullable(),
  last_success_at: z.string().nullable(),
  next_sync_at: z.string().nullable(),
  error: z.string().nullable(),
});
export const sandoStatusSchema = syncSchema.extend({
  hosts: z.array(z.object({
    addresses: z.array(z.string()).min(1).max(2),
    host_name: z.string().nullable(),
    icon: z.string().nullable(),
    classification: z.string().nullable(),
    threat_score: z.number().int().min(-1).max(100).nullable(),
  })),
  policies: syncSchema,
});
export type SandoStatus = z.infer<typeof sandoStatusSchema>;
export const getSandoStatus = (signal?: AbortSignal) =>
  request("GET", "/sando", sandoStatusSchema, undefined, signal);
export type SandoSyncTarget = "hosts" | "policies";
export const forceSandoSync = (target: SandoSyncTarget, signal?: AbortSignal) =>
  request("POST", `/sando/${target}/sync`, sandoStatusSchema, undefined, signal);

export function sandoBaseUrl(value: string): string {
  const base = value.trim().replace(/\/+$/, "").replace(/\/api$/, "");
  sandoSourceUrlSchema.parse(base);
  return base;
}

export const sandoDeviceSchema = z.object({
  ip_address: z.string(),
  ip6_address: z.string().nullish(),
  local_description: z.string().nullish(),
  icon: z.string().nullish(),
  threat_score: z.number().int().min(-1).max(100).nullish(),
}).passthrough();
export type SandoDevice = z.infer<typeof sandoDeviceSchema>;

export async function getSandoDevices(endpoint: string, signal: AbortSignal): Promise<SandoDevice[]> {
  const status = await getSandoStatus(signal);
  if (status.source_url !== sandoBaseUrl(endpoint)) throw new Error("The saved Sando source changed. Host metadata is unavailable for this endpoint.");
  if (status.error) throw new Error(`Server-side Sando host sync failed: ${status.error}`);
  return status.hosts.map(host => ({
    ip_address: host.addresses[0]!,
    ip6_address: host.addresses[1],
    local_description: host.classification,
    icon: host.icon,
    threat_score: host.threat_score,
  }));
}
