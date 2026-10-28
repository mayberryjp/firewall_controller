import { z } from "zod";
import ipaddr from "ipaddr.js";
import { revisionSchema, type Config, type PlatformStatus } from "@/types/domain";

const metric = z.number().finite().nonnegative().nullable();
export const dnsLookupRequestSchema = z.object({
  interface: z.string().regex(/^[a-zA-Z0-9_.-]{1,15}$/, "Select a configured up interface").nullish(),
  server: z.string().ip("Use a DNS server IP address").nullish(),
  hostname: z.string().refine(value => {
    const host = value.endsWith(".") ? value.slice(0, -1) : value;
    const ipLiteral = ipaddr.isValid(host) && ipaddr.parse(host).toString() === host;
    return host.length > 0 && host.length <= 253 && !ipLiteral &&
      host.split(".").every(label => label.length <= 63 && /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label));
  }, "Enter an ASCII domain name, not an IP address (labels 1..63 characters, total at most 253)")
    .transform(value => value.replace(/\.$/, "").toLowerCase()),
  record_type: z.enum(["A", "AAAA"]).default("A"),
  timeout_ms: z.number().int().min(100).max(5000).default(2000),
}).strict().refine(value => Boolean(value.interface || value.server), {
  path: ["interface"], message: "Select an interface or provide a DNS server IP address",
});
const answerFields = {
  transport: z.enum(["udp", "tcp"]).nullable(), rcode: z.number().int().min(0).max(15).nullable(),
  addresses: z.array(z.string()), rtt_ms: metric, error: z.string().nullable(),
};
export const dnsLookupSchema = z.object({
  ...answerFields,
  error: z.string().nullable().optional(),
  status: z.enum(["answered", "failed", "simulated"]), interface: z.string().nullable(), hostname: z.string(),
  record_type: z.enum(["A", "AAAA"]), server: z.string().nullable(), elapsed_ms: metric,
  attempts: z.array(z.union([
    z.object({ ...answerFields, server: z.string(), status: z.literal("answered") }),
    z.object({ server: z.string(), status: z.literal("failed"), rtt_ms: z.null(), error: z.string() }),
  ])),
  scope: z.string(), revision: revisionSchema,
});
export type DNSLookup = z.infer<typeof dnsLookupSchema>;
export type DNSLookupRequest = z.input<typeof dnsLookupRequestSchema>;
export const restartTargetSchema = z.string().min(1).max(80).regex(/^[\x20-\x7e]+$/);
export const restartResponseSchema = z.discriminatedUnion("status", [
  z.object({ target: restartTargetSchema, status: z.literal("restarted"), worker: z.record(z.unknown()) }),
  z.object({ target: restartTargetSchema, status: z.literal("simulated"), worker: z.record(z.unknown()).optional() }),
  z.object({ target: restartTargetSchema, status: z.literal("restart_requested"), generation: z.number().int().safe().nonnegative().optional() }),
]);
type Component = PlatformStatus["process_health"]["components"][number];
export function processRestartTarget(row: Component, config?: Config): string | null {
  const resource = row.resource;
  if (!resource) return null;
  switch (row.component) {
    case "daemon": return "netcontrold";
    case "appliance_services": return ["ntp", "syslog", "mdns", "bgp", "vnstat-host", "vnstat-managed"].includes(resource) ? resource : null;
    case "dhcp_relay": return "dhcp-relay";
    case "softflowd": return `flow:${resource}`;
    case "gateway_monitors": {
      const monitor = config?.gateway_monitors.find(item => item.name === resource);
      return monitor?.mode === "dhcp" ? "dhcp-gateway-monitors" : monitor ? `gateway:${resource}` : null;
    }
    case "dhcp_client": return `dhcp-client:${resource}`;
    case "mqtt": return "mqtt";
    case "dynamic_dns": return "dynamic-dns";
    case "system": return "system";
    case "daemon_tasks": return ({ mqtt: "mqtt", dynamic_dns: "dynamic-dns", system: "system" } as Record<string, string>)[resource] ?? null;
    case "managed_processes": return ["mqtt", "dynamic-dns", "system", "dhcp-gateway-monitors", "link-diagnostics"].includes(resource) ? resource : null;
    default: return null;
  }
}
