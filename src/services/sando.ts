import { z } from "zod";
import { cloneConfig, numericAddress, policyHostAddress, stableJson } from "@/services/configuration";
import { decodeJson, utf8Size } from "@/services/json";
import type { Config } from "@/types/domain";
import { sandoSourceUrlSchema } from "@/services/sandoState";

const text = z.union([z.string(), z.number(), z.boolean()]).nullish().transform(value => value == null ? value : String(value));
const integer = z.union([z.number(), z.string(), z.boolean()]).nullish();
const candidateNumber = z.union([z.number(), z.string()]).nullish().transform(value => value == null ? NaN : Number(value));
export const sandoDeviceSchema = z.object({
  ip_address: z.string(), first_seen: text, original_flow: text,
  mac_address: text, mac_vendor: text, dhcp_hostname: text, dns_hostname: text,
  os_fingerprint: text, local_description: text, lease_hostname: text,
  lease_hwaddr: text, lease_clientid: text, icon: text, tags: text,
  acknowledged: integer, threat_score: integer, alerts_enabled: integer,
  management_link: text, last_seen: text, last_dhcp_discover: text, whitelisted: integer,
  total_packets_src: integer, total_packets_dst: integer, total_bytes_src: integer,
  total_bytes_dst: integer, ip6_address: text, alert_if_offline: integer, domain_name: text,
}).passthrough();
export type SandoDevice = z.infer<typeof sandoDeviceSchema>;
export const sandoConnectionSchema = z.object({
  ignorelist_id: z.union([z.string(), z.number()]).nullish().transform(value => value == null ? undefined : String(value)),
  src_ip: z.string().nullable().transform(value => value ?? ""), dst_ip: z.string().nullable().transform(value => value ?? ""),
  dst_port: z.union([z.literal("*"), candidateNumber]), protocol: candidateNumber, added: text,
  requested_host: z.string().optional(),
}).passthrough();
export type SandoConnection = z.infer<typeof sandoConnectionSchema>;
type Policies = NonNullable<Config["firewall"]["policies"]>;

export function sandoEndpoint(value: string): string {
  return `${sandoBaseUrl(value)}/api`;
}
export function sandoBaseUrl(value: string): string {
  const base = value.trim().replace(/\/+$/, "").replace(/\/api$/, "");
  sandoSourceUrlSchema.parse(base);
  return base;
}
async function getSando<T extends z.ZodTypeAny>(endpoint: string, resource: string, schema: T, signal: AbortSignal): Promise<z.output<T>> {
  try {
    const response = await fetch(`${sandoEndpoint(endpoint)}/${resource}`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      credentials: "omit", redirect: "error", cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Sando returned HTTP ${response.status}.`);
    return schema.parse(decodeJson(await response.text()));
  } catch (error) {
    if (signal.aborted) throw error;
    if (error instanceof z.ZodError) {
      const details = error.issues.slice(0, 3).map(issue => `${issue.path.join(".") || "response"}: ${issue.message}`).join("; ");
      const remaining = error.issues.length - 3;
      throw new Error(`Unable to import from Sando: incompatible ${resource} response (${details}${remaining > 0 ? `; ${remaining} more issues` : ""}).`);
    }
    throw new Error(`Unable to import from Sando: ${error instanceof Error ? error.message : "request failed"}. Check the endpoint, browser network access, CORS and HTTPS requirements.`);
  }
}
export const getSandoDevices = (endpoint: string, signal: AbortSignal) =>
  getSando(endpoint, "localhosts", z.array(sandoDeviceSchema), signal);
export async function getSandoConnections(endpoint: string, signal: AbortSignal, hosts: string[]): Promise<SandoConnection[]> {
  const entries = new Map<string, SandoConnection>();
  for (const host of new Set(hosts)) {
    const rows = await getSando(endpoint, `ignorelist/ip/${encodeURIComponent(host)}`, z.array(sandoConnectionSchema), signal);
    for (const row of rows) {
      const key = stableJson([row.ignorelist_id ?? null, row.src_ip, row.dst_ip, row.protocol, row.dst_port]);
      if (!entries.has(key) || row.src_ip === host) entries.set(key, { ...row, requested_host: host });
    }
  }
  return [...entries.values()];
}

export function sandoDeviceName(device: SandoDevice): string {
  return device.dhcp_hostname || device.lease_hostname || device.dns_hostname || device.domain_name || device.ip_address;
}
function hostName(device: SandoDevice, hosts: Policies["hosts"]): string {
  let name = sandoDeviceName(device).trim().replace(/\p{Cc}/gu, "");
  if (!name) name = device.ip_address;
  while (utf8Size(name) > 80) name = [...name].slice(0, -1).join("");
  name = name.trimEnd();
  if (!hosts.some(host => host.name === name)) return name;
  return device.ip_address;
}
export interface SandoImport {
  config: Config;
  hostsAdded: number;
  rulesAdded: number;
  duplicates: number;
  skipped: string[];
  hostsSkipped: number;
}
export function importSando(
  current: Config, devices: SandoDevice[], connections: SandoConnection[] | undefined,
  newHostPolicy: "accept" | "drop",
): SandoImport {
  if (current.firewall.rules.length) {
    throw new Error("Legacy forwarding rules cannot coexist with host policies. Review and remove legacy rules in the shared draft before importing; no rules were removed.");
  }
  const config = cloneConfig(current);
  const policies = config.firewall.policies ?? { hosts: [], interfaces: [] };
  const result: SandoImport = { config, hostsAdded: 0, rulesAdded: 0, duplicates: 0, skipped: [], hostsSkipped: 0 };
  function addHost(device: SandoDevice, addresses: string[]): Policies["hosts"][number] {
    const id = `sando_${device.ip_address.replace(/[:.]/g, "_")}`;
    if (policies.hosts.some(host => host.id === id)) throw new Error(`host ID ${id} already exists`);
    const name = hostName(device, policies.hosts);
    if (policies.hosts.some(host => host.name === name)) throw new Error(`host name ${name} already exists`);
    const host: Policies["hosts"][number] = { id, name, addresses, policy: newHostPolicy, rules: [] };
    policies.hosts.push(host);
    result.hostsAdded++;
    return host;
  }
  for (const device of devices) {
    try {
      policyHostAddress(device.ip_address);
      if (config.ipv6_enabled === false && numericAddress(device.ip_address).kind() === "ipv6") throw new Error("IPv6 is disabled");
      const addresses = [device.ip_address];
      if (device.ip6_address && device.ip6_address !== device.ip_address) {
        policyHostAddress(device.ip6_address);
        if (numericAddress(device.ip6_address).kind() !== "ipv6") throw new Error("ip6_address must be IPv6");
        if (config.ipv6_enabled === false) throw new Error("IPv6 is disabled");
        addresses.push(device.ip6_address);
      }
      const owners = policies.hosts.filter(host => host.addresses.some(address => addresses.includes(address)));
      if (owners.length) {
        if (owners.length === 1 && addresses.every(address => owners[0]!.addresses.includes(address))) result.duplicates++;
        else result.skipped.push(`${device.ip_address}: an address already belongs to an existing host; existing addresses were preserved.`);
        continue;
      }
      addHost(device, addresses);
    } catch (error) {
      result.skipped.push(`${device.ip_address}: ${error instanceof Error ? error.message : "invalid host"}`);
    }
  }
  result.hostsSkipped = result.skipped.length;
  for (const connection of connections ?? []) {
    try {
      const source = policyHostAddress(connection.src_ip);
      if (config.ipv6_enabled === false && source.kind() === "ipv6") throw new Error("IPv6 is disabled");
      const destination = connection.dst_ip === "*" ? undefined : policyHostAddress(connection.dst_ip);
      if (destination && source.kind() !== destination.kind()) throw new Error("source and destination address families differ");
      const protocol = connection.protocol === 6 ? "tcp" : connection.protocol === 17 ? "udp"
        : connection.protocol === 1 ? "icmp" : connection.protocol === 58 ? "icmpv6" : undefined;
      if (!protocol) throw new Error("only TCP (6), UDP (17), ICMP (1) and ICMPv6 (58) are supported");
      if ((protocol === "icmp" && source.kind() !== "ipv4") || (protocol === "icmpv6" && source.kind() !== "ipv6")) {
        throw new Error("source and destination must match the protocol's address family");
      }
      if ((protocol === "icmp" || protocol === "icmpv6") && connection.dst_port !== "*") throw new Error("ICMP and ICMPv6 must not specify destination ports");
      if (connection.dst_port !== "*" && (!Number.isInteger(connection.dst_port) || connection.dst_port < 1 || connection.dst_port > 65535)) throw new Error("destination port must be 1..65535 or an explicit * wildcard");
      const rule: Policies["hosts"][number]["rules"][number] = {
        origin: "import", import_source: "sando",
        destination: destination ? `${connection.dst_ip}/${destination.kind() === "ipv4" ? 32 : 128}` : source.kind() === "ipv4" ? "0.0.0.0/0" : "::/0",
        protocol,
        ...(connection.dst_port === "*" ? {} : { destination_ports: [connection.dst_port] }), action: "accept",
      };
      let host = policies.hosts.find(host => host.addresses.includes(connection.src_ip));
      if (!host) {
        if (devices.some(device => device.ip_address === connection.src_ip || device.ip6_address === connection.src_ip)) {
          throw new Error("source device could not be imported; resolve its host validation error first");
        }
        host = addHost({ ip_address: connection.src_ip }, [connection.src_ip]);
      }
      const signature = (value: typeof rule) => stableJson({
        destination: value.destination, destination_host: value.destination_host || undefined,
        out_interface: value.out_interface || undefined, protocol: value.protocol || undefined,
        destination_ports: value.destination_ports?.length ? value.destination_ports.slice().sort((a, b) => a - b) : undefined, action: value.action,
      });
      if (host.rules.some(existing => signature(existing) === signature(rule))) { result.duplicates++; continue; }
      host.rules.push(rule);
      result.rulesAdded++;
    } catch (error) {
      const label = connection.ignorelist_id || `${connection.src_ip} -> ${connection.dst_ip} (protocol ${connection.protocol}, port ${connection.dst_port})`;
      result.skipped.push(`${label}: ${error instanceof Error ? error.message : "invalid connection"}`);
    }
  }
  if (result.hostsAdded || result.rulesAdded) config.firewall.policies = policies;
  return result;
}

export interface SandoRuleReplacement extends SandoImport {
  rulesRemoved: number;
  changes: Array<{ hostID: string; hostName: string; before: Policies["hosts"][number]["rules"]; after: Policies["hosts"][number]["rules"] }>;
}
export function replaceSandoRules(current: Config, devices: SandoDevice[], connections: SandoConnection[], policy: "accept" | "drop"): SandoRuleReplacement {
  const candidate = cloneConfig(current), affected = new Set<string>();
  const previousRules = new Map((candidate.firewall.policies?.hosts ?? []).map(host => [host.id, host.rules]));
  const owned = (rule: Policies["hosts"][number]["rules"][number]) => rule.origin === "import" && rule.import_source === "sando";
  let rulesRemoved = 0;
  for (const host of candidate.firewall.policies?.hosts ?? []) {
    const remaining = host.rules.filter(rule => !owned(rule));
    if (remaining.length !== host.rules.length) {
      affected.add(host.id); rulesRemoved += host.rules.length - remaining.length; host.rules = remaining;
    }
  }
  const result = importSando(candidate, devices, connections, policy);
  if (result.skipped.length && !result.rulesAdded) throw new Error("No replacement rules could be imported cleanly. Existing rules and reports were retained; resolve the skipped source entries before replacing Sando rules.\n" + result.skipped.join("\n"));
  const changes: SandoRuleReplacement["changes"] = [];
  for (const host of result.config.firewall.policies?.hosts ?? []) {
    if (!affected.has(host.id) && !host.rules.some(owned)) continue;
    host.rules = [
      ...host.rules.filter(rule => (rule.origin ?? "manual") === "manual"),
      ...host.rules.filter(rule => (rule.origin ?? "manual") !== "manual"),
    ];
    changes.push({ hostID: host.id, hostName: host.name, before: previousRules.get(host.id) ?? [], after: host.rules });
  }
  return { ...result, rulesRemoved, changes };
}
