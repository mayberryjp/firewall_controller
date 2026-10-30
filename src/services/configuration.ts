import ipaddr from "ipaddr.js";
import { configSchema, mqttSchema, blackholeSchema, systemSchema, bgpSchema, type Config, type ManagedInterface, type ParentInterface, type RepairService, type Route } from "@/types/domain";
import { decodeJson, utf8Size } from "@/services/json";
import { normalizeMDNS, validateMDNS } from "@/services/mdns";
import { validateUDPRelay } from "@/services/udpBroadcastRelay";
import { sandoSchema } from "@/services/sandoState";
import { firewallProtocolFamily, parseFirewallPorts, supportsFirewallPorts } from "@/services/firewallProtocols";

export const cloneConfig = (config: Config): Config => {
  const editable = JSON.parse(JSON.stringify(config)) as Config;
  delete editable.software;
  return editable;
};
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function normalize(config: Config): Config {
  const parsed = configSchema.safeParse(config);
  const result = cloneConfig(parsed.success ? parsed.data : config);
  if (result.sando && stableJson(result.sando) === stableJson(sandoSchema.parse({}))) delete result.sando;
  if (result.ipv6_enabled === true) delete result.ipv6_enabled;
  if (result.mqtt && stableJson(result.mqtt) === stableJson(mqttSchema.parse({}))) delete result.mqtt;
  if (!result.dynamic_dns?.length) delete result.dynamic_dns;
  if (result.blackhole && stableJson(result.blackhole) === stableJson(blackholeSchema.parse({}))) delete result.blackhole;
  if (result.system && stableJson(result.system) === stableJson(systemSchema.parse({}))) delete result.system;
  if (result.bgp && stableJson(result.bgp) === stableJson(bgpSchema.parse({}))) delete result.bgp;
  result.bgp?.neighbors.sort((a, b) => a.name.localeCompare(b.name));
  result.udp_broadcast_relay?.instances.sort((first, second) => first.id - second.id);
  result.udp_broadcast_relay?.instances.forEach(instance => instance.interfaces.sort());
  if (!result.firewall.nat.destination_rewrite?.length) delete result.firewall.nat.destination_rewrite;
  result.dynamic_dns?.sort((a, b) => a.name.localeCompare(b.name));
  for (const area of ["dhcp_clients", "dns"] as const) {
    if (!Object.keys(result[area] ?? {}).length) delete result[area];
  }
  for (const settings of Object.values(result.dns ?? {})) {
    if (settings.override_dhcp_dns === true) delete settings.override_dhcp_dns;
    settings.servers.sort();
    settings.domains.sort((first, second) => first.name.localeCompare(second.name));
  }
  result.interfaces.sort((a, b) => a.name.localeCompare(b.name));
  for (const link of result.interfaces) {
    link.addresses.sort();
    link.dhcp_relay.servers.sort();
    if (link.kind === "wireguard") {
      link.wireguard.peers.sort((a, b) => a.public_key.localeCompare(b.public_key));
      for (const peer of link.wireguard.peers) {
        peer.allowed_ips.sort();
        peer.enabled ??= true;
        if (!peer.endpoint) delete peer.endpoint;
      }
    }
  }
  result.routes.sort((a, b) => `${a.table}/${a.destination}/${a.metric}`.localeCompare(`${b.table}/${b.destination}/${b.metric}`));
  result.routes.forEach((route) => { if (!route.gateway) delete route.gateway; });
  result.softflowd.sort((a, b) => a.name.localeCompare(b.name));
  result.softflowd.forEach((service) => { if (!service.capture_filter) delete service.capture_filter; });
  result.gateway_monitors.sort((a, b) => a.name.localeCompare(b.name));
  result.ntp.servers.sort();
  if (result.mdns) normalizeMDNS(result.mdns);
  result.syslog.servers.sort((a, b) => {
    const first = `${a.transport}:${a.host}:${a.port}`, second = `${b.transport}:${b.host}:${b.port}`;
    return first < second ? -1 : first > second ? 1 : 0;
  });
  for (const rule of [...result.firewall.rules, ...result.firewall.nat.masquerade]) {
    if (!rule.source) delete rule.source;
    if ("destination" in rule && !rule.destination) delete rule.destination;
  }
  for (const rule of result.firewall.rules) {
    if (!rule.protocol) delete rule.protocol;
    if (rule.destination_ports?.length) rule.destination_ports.sort((a, b) => a - b);
    else delete rule.destination_ports;
  }
  if (result.firewall.policies) {
    result.firewall.policies.hosts.sort((a, b) => a.id.localeCompare(b.id));
    result.firewall.policies.interfaces.sort((a, b) => a.interface.localeCompare(b.interface));
    for (const host of result.firewall.policies.hosts) host.addresses.sort();
    for (const item of [...result.firewall.policies.hosts, ...result.firewall.policies.interfaces]) {
      for (const rule of item.rules) {
        rule.destination_ports?.sort((a, b) => a - b);
        for (const key of ["out_interface", "destination", "destination_host", "protocol"] as const) if (!rule[key]) delete rule[key];
        if (!rule.destination_ports?.length) delete rule.destination_ports;
      }
    }
  } else delete result.firewall.policies;
  if (result.firewall.input) {
    result.firewall.input.interfaces.sort((first, second) => first.interface.localeCompare(second.interface));
    for (const ingress of result.firewall.input.interfaces) {
      for (const rule of ingress.rules) {
        rule.destination_ports?.sort((first, second) => first - second);
        for (const key of ["destination", "protocol", "out_interface", "destination_host"] as const) if (!rule[key]) delete rule[key];
        if (!rule.destination_ports?.length) delete rule.destination_ports;
      }
    }
  } else delete result.firewall.input;
  return result;
}
export const equalConfig = (a: Config, b: Config): boolean => stableJson(normalize(a)) === stableJson(normalize(b));

const wireGuardRouteDescription = "Automatically managed from WireGuard Allowed IPs.";
export const isWireGuardRoute = (route: Route): boolean =>
  route.metadata?.description === wireGuardRouteDescription;

export function syncWireGuardRoutes(config: Config): void {
  const required = new Map<string, { interface: string; enabled: boolean }>();
  for (const tunnel of config.interfaces) {
    if (tunnel.kind !== "wireguard") continue;
    for (const peer of tunnel.wireguard.peers) for (const destination of peer.allowed_ips) {
      prefix(destination, true);
      const existing = required.get(destination);
      if (existing && existing.interface !== tunnel.name) {
        throw new Error(`Allowed network ${destination} belongs to both ${existing.interface} and ${tunnel.name}; automatic main-table routes require a single tunnel per network.`);
      }
      required.set(destination, { interface: tunnel.name, enabled: Boolean(existing?.enabled || peer.enabled !== false) });
    }
  }
  const routes = config.routes.filter(route => !isWireGuardRoute(route));
  for (const [destination, target] of required) {
    const manual = routes.find(route => route.destination === destination && route.table === 254 &&
      route.interface === target.interface && !route.gateway && route.enabled === target.enabled);
    if (manual) continue;
    if (routes.some(route => route.destination === destination && route.table === 254 && route.metric === 1)) {
      throw new Error(`Automatic route for ${destination} on ${target.interface} conflicts with a manual route in table 254, metric 1. Update or remove that route in Static Routes first.`);
    }
    const previous = config.routes.find(route => isWireGuardRoute(route) && route.destination === destination && route.interface === target.interface);
    routes.push({
      ...previous, destination, interface: target.interface, enabled: target.enabled, table: 254, metric: 1,
      metadata: { display_name: previous?.metadata?.display_name ?? "", description: wireGuardRouteDescription },
    });
    delete routes[routes.length - 1]!.gateway;
  }
  config.routes = routes;
}

export interface Difference {
  area: string; identity: string; kind: "added" | "deleted" | "modified" | "moved";
  before?: unknown; after?: unknown;
}
export function differences(before: Config, after: Config): Difference[] {
  const old = normalize(before), next = normalize(after);
  const result: Difference[] = [];
  if ((old.ipv6_enabled !== false) !== (next.ipv6_enabled !== false)) result.push({
    area: "ipv6", identity: "Enable IPv6", kind: "modified",
    before: old.ipv6_enabled !== false, after: next.ipv6_enabled !== false,
  });
  function named<T>(area: string, a: T[], b: T[], key: (value: T) => string): void {
    const previous = new Map(a.map((value) => [key(value), value]));
    const current = new Map(b.map((value) => [key(value), value]));
    for (const [identity, value] of previous) {
      if (!current.has(identity)) result.push({ area, identity, kind: "deleted", before: value });
      else if (stableJson(value) !== stableJson(current.get(identity))) {
        result.push({ area, identity, kind: "modified", before: value, after: current.get(identity) });
      }
    }
    for (const [identity, value] of current) {
      if (!previous.has(identity)) result.push({ area, identity, kind: "added", after: value });
    }
  }
  function ordered(area: string, a: unknown[], b: unknown[]): void {
    const used = new Set<number>();
    b.forEach((value, index) => {
      const match = a.findIndex((previous, previousIndex) => !used.has(previousIndex) && stableJson(value) === stableJson(previous));
      if (match === -1) result.push({ area, identity: `position ${index + 1}`, kind: "added", after: value });
      else {
        used.add(match);
        if (match !== index) result.push({ area, identity: `${match + 1} -> ${index + 1}`, kind: "moved", before: a[match], after: value });
      }
    });
    a.forEach((value, index) => {
      if (!used.has(index)) result.push({ area, identity: `position ${index + 1}`, kind: "deleted", before: value });
    });
  }
  named("interfaces", old.interfaces, next.interfaces, (item) => item.name);
  for (const area of ["dhcp_clients", "dns"] as const) {
    named(area, Object.entries(old[area] ?? {}), Object.entries(next[area] ?? {}), item => item[0]);
  }
  named("routes", old.routes, next.routes, (item) => `${item.table}/${item.destination}/${item.metric}`);
  named("softflowd", old.softflowd, next.softflowd, (item) => item.name);
  named("gateway_monitors", old.gateway_monitors, next.gateway_monitors, item => item.name);
  named("dynamic_dns", old.dynamic_dns ?? [], next.dynamic_dns ?? [], item => item.name);
  for (const area of ["ntp", "syslog", "vnstat", "mdns", "mqtt", "blackhole", "system", "bgp", "udp_broadcast_relay", "sando"] as const) {
    if (stableJson(old[area]) !== stableJson(next[area])) result.push({
      area, identity: "appliance service", kind: "modified", before: old[area], after: next[area],
    });
  }
  if (old.firewall.policy !== next.firewall.policy) result.push({
    area: "firewall-policy", identity: "default policy", kind: "modified",
    before: old.firewall.policy, after: next.firewall.policy,
  });
  if (old.firewall.allow_all_icmp !== next.firewall.allow_all_icmp) result.push({
    area: "firewall-icmp", identity: "Allow all IPv4 ICMP", kind: "modified",
    before: old.firewall.allow_all_icmp, after: next.firewall.allow_all_icmp,
  });
  if (stableJson(old.firewall.policies) !== stableJson(next.firewall.policies)) result.push({
    area: "firewall-policies", identity: "host / ingress policies", kind: "modified",
    before: old.firewall.policies, after: next.firewall.policies,
  });
  ordered("firewall", old.firewall.rules, next.firewall.rules);
  if (stableJson(old.firewall.input) !== stableJson(next.firewall.input)) result.push({
    area: "firewall-input", identity: "host input policy", kind: !old.firewall.input ? "added" : !next.firewall.input ? "deleted" : "modified",
    before: old.firewall.input, after: next.firewall.input,
  });
  ordered("nat", old.firewall.nat.masquerade, next.firewall.nat.masquerade);
  ordered("dnat", old.firewall.nat.destination_rewrite ?? [], next.firewall.nat.destination_rewrite ?? []);
  if (stableJson(old.kernel) !== stableJson(next.kernel)) result.push({
    area: "kernel", identity: "preserved settings", kind: "modified", before: old.kernel, after: next.kernel,
  });
  return result;
}

// Applies one change to the old configuration so the review can diff it inside the whole document.
export function differenceContext(old: Config, next: Config, change: Difference): { before: Config; after: Config } {
  const doc = cloneConfig(old), unchanged = { before: old, after: old };
  const entry = (value: unknown) => Array.isArray(value) ? { [String(value[0])]: value[1] } : value;
  const entries = (value?: Record<string, unknown>) => Object.entries(value ?? {}).map(entry);
  const record = (list: unknown[]) => list.length ? Object.assign({}, ...list as object[]) : undefined;
  const lists: Record<string, [unknown[], unknown[], (list: unknown[]) => void]> = {
    interfaces: [old.interfaces, next.interfaces, list => { doc.interfaces = list as Config["interfaces"]; }],
    routes: [old.routes, next.routes, list => { doc.routes = list as Config["routes"]; }],
    softflowd: [old.softflowd, next.softflowd, list => { doc.softflowd = list as Config["softflowd"]; }],
    gateway_monitors: [old.gateway_monitors, next.gateway_monitors, list => { doc.gateway_monitors = list as Config["gateway_monitors"]; }],
    dynamic_dns: [old.dynamic_dns ?? [], next.dynamic_dns ?? [], list => { doc.dynamic_dns = list as Config["dynamic_dns"]; }],
    firewall: [old.firewall.rules, next.firewall.rules, list => { doc.firewall.rules = list as Config["firewall"]["rules"]; }],
    nat: [old.firewall.nat.masquerade, next.firewall.nat.masquerade, list => { doc.firewall.nat.masquerade = list as Config["firewall"]["nat"]["masquerade"]; }],
    dnat: [old.firewall.nat.destination_rewrite ?? [], next.firewall.nat.destination_rewrite ?? [], list => { doc.firewall.nat.destination_rewrite = list as NonNullable<Config["firewall"]["nat"]["destination_rewrite"]>; }],
    dhcp_clients: [entries(old.dhcp_clients), entries(next.dhcp_clients), list => { doc.dhcp_clients = record(list) as Config["dhcp_clients"]; }],
    dns: [entries(old.dns), entries(next.dns), list => { doc.dns = record(list) as Config["dns"]; }],
  };
  const collection = lists[change.area];
  if (collection) {
    if (change.kind === "moved") return unchanged;
    const [previous, current, assign] = collection, ordered = ["firewall", "nat", "dnat"].includes(change.area);
    const [was, now] = change.area === "dhcp_clients" || change.area === "dns" ? [entry(change.before), entry(change.after)] : [change.before, change.after];
    const find = (items: unknown[], value: unknown) => items.findIndex(item => stableJson(item) === stableJson(value));
    const position = Number(/^position (\d+)$/.exec(change.identity)?.[1]) - 1;
    const list = [...previous];
    if (change.kind === "added") list.splice(Math.min(Math.max(ordered ? position : find(current, now), 0), list.length), 0, now);
    else {
      const index = ordered ? position : find(previous, was);
      if (index < 0 || index >= list.length) return unchanged;
      if (change.kind === "deleted") list.splice(index, 1); else list[index] = now;
    }
    assign(list);
    if (!doc.dhcp_clients) delete doc.dhcp_clients;
    if (!doc.dns) delete doc.dns;
    if (!doc.dynamic_dns?.length) delete doc.dynamic_dns;
  } else if (["ntp", "syslog", "vnstat", "mdns", "mqtt", "blackhole", "system", "kernel", "bgp", "udp_broadcast_relay", "sando"].includes(change.area)) Object.assign(doc, { [change.area]: change.after });
  else if (change.area === "ipv6") doc.ipv6_enabled = change.after === false ? false : undefined;
  else if (change.area === "firewall-policy") doc.firewall.policy = change.after as Config["firewall"]["policy"];
  else if (change.area === "firewall-icmp") doc.firewall.allow_all_icmp = change.after as boolean;
  else if (change.area === "firewall-policies") doc.firewall.policies = change.after as Config["firewall"]["policies"];
  else if (change.area === "firewall-input") doc.firewall.input = change.after as Config["firewall"]["input"];
  else return unchanged;
  return { before: old, after: doc };
}
export function numericAddress(text: string): ipaddr.IPv4 | ipaddr.IPv6 {
  if (text.includes("%") || !ipaddr.isValid(text)) throw new Error("Use an IP without a zone");
  const address = ipaddr.parse(text);
  if (address.kind() === "ipv6" && address instanceof ipaddr.IPv6 && address.isIPv4MappedAddress()) {
    throw new Error("IPv4-mapped IPv6 is not accepted");
  }
  const canonical = address instanceof ipaddr.IPv6 ? address.toRFC5952String() : address.toString();
  if (canonical !== text) throw new Error(`Use canonical address ${canonical}`);
  return address;
}
export function prefix(text: string, network: boolean): { family: string; address: ipaddr.IPv4 | ipaddr.IPv6 } {
  const parts = text.split("/");
  const addressText = parts[0], bitsText = parts[1];
  if (parts.length !== 2 || !addressText || bitsText === undefined || !/^(0|[1-9]\d*)$/.test(bitsText)) {
    throw new Error("Use a canonical address/prefix length");
  }
  const address = numericAddress(addressText);
  const bits = Number(bitsText), max = address.kind() === "ipv4" ? 32 : 128;
  if (bits > max) throw new Error(`Prefix length must be 0..${max}`);
  const bytes = address.toByteArray();
  const masked = bytes.map((byte, index) => byte & (index * 8 >= bits ? 0 : index * 8 + 8 <= bits ? 255 : 255 << (8 - bits % 8)));
  if (network && masked.some((byte, index) => byte !== bytes[index])) {
    const suggested = ipaddr.fromByteArray(masked);
    throw new Error(`Host bits must be cleared. Review and enter ${suggested.toString()}/${bits}`);
  }
  return { family: address.kind(), address };
}
export function policyHostAddress(text: string): ipaddr.IPv4 | ipaddr.IPv6 {
  const address = numericAddress(text);
  if (!globalUnicast(address)) throw new Error("Use a canonical unicast host IP, without CIDR, loopback or link-local addresses");
  return address;
}
function globalUnicast(address: ipaddr.IPv4 | ipaddr.IPv6, loopback = false): boolean {
  const bytes = address.toByteArray();
  if (address.kind() === "ipv4") {
    if (bytes.every((byte) => byte === 0) || bytes.every((byte) => byte === 255)) return false;
    return (loopback || bytes[0] !== 127) && !(bytes[0] === 169 && bytes[1] === 254) && !((bytes[0] ?? 0) >= 224 && (bytes[0] ?? 0) <= 239);
  }
  const isLoopback = bytes.slice(0, -1).every((byte) => byte === 0) && bytes[15] === 1;
  return !bytes.every((byte) => byte === 0) && (loopback || !isLoopback) &&
    bytes[0] !== 255 && !(bytes[0] === 254 && ((bytes[1] ?? 0) & 192) === 128);
}
export function selectedRelayPrefix(link: Pick<ManagedInterface, "addresses">): string | undefined {
  for (const value of [...link.addresses].sort()) {
    const parsed = prefix(value, false);
    if (parsed.family === "ipv4" && globalUnicast(parsed.address)) return value;
  }
  return undefined;
}
export function serviceRepairPermissions(config: Config, service: RepairService): string[] {
  const permissions = ["state.read", "transactions.write"];
  if (service === "dhcp-relay" || config.interfaces.some(link => link.dhcp_relay.enabled) ||
      Object.keys(config.dhcp_clients ?? {}).length || Object.keys(config.dns ?? {}).length) permissions.push("interfaces.write");
  if (service === "softflowd" || config.softflowd.some(item => item.enabled)) permissions.push("softflowd.write");
  if (service === "gateway-monitoring" || config.gateway_monitors.some(item => item.enabled)) permissions.push("gateway_monitors.write");
  for (const name of ["ntp", "syslog", "vnstat"] as const) {
    if (service === name || config[name].enabled) permissions.push(`${name}.write`);
  }
  if (service === "mdns" || config.mdns?.enabled) permissions.push("mdns.write");
  if (config.bgp?.enabled) permissions.push("bgp.write");
  if (service === "udp-broadcast-relay" || config.udp_broadcast_relay?.enabled) permissions.push("udp_broadcast_relay.write");
  return permissions;
}
export function validateServerHost(host: string): void {
  if (ipaddr.isValid(host)) {
    if (!globalUnicast(numericAddress(host), true)) throw new Error("Use canonical unicast/loopback IP or lowercase ASCII DNS host");
    return;
  }
  if (!host || host.length > 253 || /^[\d.]+$/.test(host) ||
    !host.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw new Error("Use canonical unicast/loopback IP or lowercase ASCII DNS labels, no URI, port, zone, whitespace or trailing dot");
  }
}
function endpointHost(text: string): { host: string; bracketed: boolean } {
  const match = /^(\[[^\]]+\]|[^:]+):([1-9]\d*)$/.exec(text);
  if (!match?.[1] || !match[2]) throw new Error("Use host:port; bracket IPv6");
  if (Number(match[2]) > 65535) throw new Error("Port must be 1..65535");
  return { host: match[1].replace(/^\[|\]$/g, ""), bracketed: match[1].startsWith("[") };
}
export function endpoint(text: string, collector = false): void {
  const { host, bracketed } = endpointHost(text);
  const address = numericAddress(host);
  if ((address.kind() === "ipv6") !== bracketed) throw new Error("Bracket IPv6 only");
  if (collector && !globalUnicast(address, true)) throw new Error("Collector must be unicast or loopback");
}
export function wireguardEndpoint(text: string): void {
  if (!text) return;
  const { host, bracketed } = endpointHost(text);
  if (!bracketed && !ipaddr.isValid(host) && !/^[\d.]+$/.test(host)) {
    validateServerHost(host);
    return;
  }
  endpoint(text);
  if (["unspecified", "multicast"].includes(numericAddress(host).range())) throw new Error("WireGuard endpoints must not be unspecified or multicast");
}
export interface ValidationIssue { path: string; message: string; page: string }
export function ipv6Conflicts(config: Config): string[] {
  const conflicts: string[] = [];
  function visit(value: unknown, path: string): void {
    if (Array.isArray(value)) { value.forEach((item, index) => visit(item, `${path}.${index}`)); return; }
    if (value && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) {
        if (key !== "metadata" && key !== "kernel" && key !== "mqtt" && key !== "sando" && key !== "software") visit(item, path ? `${path}.${key}` : key);
      }
      return;
    }
    if (typeof value !== "string") return;
    let ipv6 = false;
    try {
      if (value.startsWith("[")) { endpoint(value); ipv6 = true; }
      else ipv6 = (value.includes("/") ? ipaddr.parseCIDR(value)[0] : ipaddr.parse(value)).kind() === "ipv6";
    } catch { ipv6 = false; }
    if (ipv6 || (path.endsWith(".family") && value === "ipv6") ||
      (path.endsWith(".capture_filter") && ["ip6", "icmp6"].includes(value))) conflicts.push(path);
  }
  visit(config, "");
  if (config.mqtt?.endpoint) {
    try { if (new URL(config.mqtt.endpoint).hostname.includes(":")) conflicts.push("mqtt.endpoint"); } catch { return conflicts; }
  }
  return conflicts;
}
export function validateConfig(config: Config, parents: ParentInterface[] = [], baseline?: Config): ValidationIssue[] {
  const issues: ValidationIssue[] = [...validateMDNS(config), ...validateUDPRelay(config)];
  if (config.sando) {
    const parsed = sandoSchema.safeParse(config.sando);
    if (!parsed.success) for (const error of parsed.error.issues) issues.push({
      path: `sando.${error.path.join(".")}`, message: error.message, page: "/settings/sando",
    });
  }
  const issue = (path: string, message: string, page: string) => issues.push({ path, message, page });
  if (config.ipv6_enabled === false) {
    for (const path of ipv6Conflicts(config)) issue(path, "IPv6 is disabled globally. Enable IPv6 in General settings or remove this setting.", "/settings/general");
  }
  function check(path: string, page: string, action: () => void): void {
    try { action(); } catch (error) { issue(path, error instanceof Error ? error.message : "Invalid value", page); }
  }
  function bound(value: number, min: number, max: number, path: string, page: string): void {
    if (!Number.isInteger(value) || value < min || value > max) issue(path, `Must be an integer ${min}..${max}`, page);
  }
  const names = new Set<string>(), vlanIDs = new Set<string>(), routeIDs = new Set<string>(), relayAddresses = new Set<string>();
  const validName = (name: string) => /^[a-zA-Z0-9_.-]{1,15}$/.test(name) && !["lo", ".", ".."].includes(name);
  const interfaces = new Map(config.interfaces.map((link) => [link.name, link]));
  if (config.bgp) {
    const settings = config.bgp, page = "/routing/bgp", peerNames = new Set<string>(), peerAddresses = new Set<string>(), peerKeys = new Set<string>();
    const validASN = (asn: number) => Number.isInteger(asn) && asn > 0 && asn < 4294967295 && ![23456, 65535].includes(asn);
    const ipv4 = (text: string) => {
      const address = numericAddress(text);
      const bytes = address.toByteArray();
      if (address.kind() !== "ipv4" || bytes.every(byte => byte === 0) || bytes[0] === 127 || bytes[0]! >= 224) throw new Error("Use a nonzero unicast IPv4 address");
      return address;
    };
    bound(settings.hold_seconds, 3, 65535, "bgp.hold_seconds", page);
    bound(settings.keepalive_seconds, 1, Math.floor(settings.hold_seconds / 3), "bgp.keepalive_seconds", page);
    bound(settings.max_prefixes, 1, 16384, "bgp.max_prefixes", page);
    if (settings.enabled || settings.neighbors.length || settings.local_asn || settings.router_id) {
      if (!validASN(settings.local_asn)) issue("bgp.local_asn", "Use ASN 1..4294967294, excluding 23456 and 65535", page);
      check("bgp.router_id", page, () => { ipv4(settings.router_id); });
    }
    if (settings.enabled && !settings.neighbors.length) issue("bgp.neighbors", "Enabled BGP requires at least one peer", page);
    if (settings.neighbors.length > 32) issue("bgp.neighbors", "At most 32 BGP peers", page);
    settings.neighbors.forEach((peer, index) => {
      const path = `bgp.neighbors.${index}`;
      if (!validName(peer.name) || peerNames.has(peer.name)) issue(`${path}.name`, "Use a unique peer name, 1..15 letters, digits, dot, underscore or hyphen", page);
      peerNames.add(peer.name);
      if (!validASN(peer.remote_asn)) issue(`${path}.remote_asn`, "Use ASN 1..4294967294, excluding 23456 and 65535", page);
      check(path, page, () => {
        const remote = ipv4(peer.address); ipv4(peer.local_address);
        if (peerAddresses.has(peer.address) || peer.address === peer.local_address) throw new Error("Peer address must be unique and different from the local address");
        peerAddresses.add(peer.address);
        const link = interfaces.get(peer.interface);
        if (!link?.up) throw new Error("Select an up configured interface");
        if (!link.addresses.some(address => address.split("/")[0] === peer.local_address)) throw new Error("Select a static local IPv4 address on the interface");
        const contains = (cidr: string) => { const network = ipaddr.parseCIDR(cidr); return network[0].kind() === "ipv4" && remote.match(network); };
        if (link.kind === "wireguard") {
          const wg = link.wireguard.peers.find(item => item.enabled !== false && item.public_key === peer.wireguard_public_key);
          if (!wg || !wg.allowed_ips.some(contains)) throw new Error("Select an enabled WireGuard peer whose static AllowedIPs cover the BGP address");
          const key = `${link.name}/${peer.wireguard_public_key}`;
          if (peerKeys.has(key)) throw new Error("Only one BGP neighbor per WireGuard peer");
          peerKeys.add(key);
        } else if (peer.wireguard_public_key || !link.addresses.some(contains)) throw new Error("Non-WireGuard peers must be directly connected and have no WireGuard key");
      });
    });
  }
  if (config.system) {
    const { hostname, domain, timezone } = config.system, page = "/settings/general";
    if (hostname && !/^(?!-)[a-z0-9-]{1,63}(?<!-)$/.test(hostname)) issue("system.hostname", "Host name must be 1..63 lowercase letters, digits or hyphens, not starting or ending with a hyphen", page);
    if (domain && (domain.length > 253 || /^[0-9.]+$/.test(domain) || !domain.split(".").every(label => /^(?!-)[a-z0-9-]{1,63}(?<!-)$/.test(label)))) {
      issue("system.domain", "Domain name must be a lowercase dot-separated name up to 253 characters, with labels of 1..63 letters, digits or hyphens, no leading or trailing hyphens, no trailing dot, and not a bare IP address or all digits", page);
    }
    if (hostname && domain && hostname.length + 1 + domain.length > 253) issue("system.domain", "Host name and domain name together must not exceed 253 characters", page);
    if (timezone && (timezone.length > 64 || !/^[A-Za-z0-9_+-]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(timezone))) issue("system.timezone", "Time zone must be an IANA name such as America/New_York", page);
  }
  if (config.mqtt) {
    const settings = config.mqtt, page = "/settings/mqtt-streaming";
    if (utf8Size(settings.endpoint) > 1024) issue("mqtt.endpoint", "Broker URL must be at most 1024 UTF-8 bytes", page);
    if (settings.endpoint) check("mqtt.endpoint", page, () => {
      const url = new URL(settings.endpoint);
      if (!["mqtt:", "mqtts:"].includes(url.protocol) || !url.hostname || url.username || url.password ||
        !["", "/"].includes(url.pathname) || url.search || url.hash || /\s/.test(settings.endpoint) ||
        (url.port && (!/^\d+$/.test(url.port) || Number(url.port) < 1 || Number(url.port) > 65535))) {
        throw new Error("Use mqtt:// or mqtts:// with a host and optional port, without credentials, path, query or fragment");
      }
    });
    if (utf8Size(settings.username) > 256 || /\p{Cc}/u.test(settings.username)) issue("mqtt.username", "Use at most 256 UTF-8 bytes without control characters", page);
    if (settings.password_ref && !settings.username) issue("mqtt.username", "A stored password requires a username", page);
    if (settings.source_interface && !/^[a-zA-Z0-9_.-]{1,15}$/.test(settings.source_interface)) issue("mqtt.source_interface", "Use a valid interface name", page);
    bound(settings.interval_seconds, 10, 3600, "mqtt.interval_seconds", page);
    if (settings.enabled) {
      if (!settings.endpoint) issue("mqtt.endpoint", "Select a broker URL", page);
      if (!interfaces.get(settings.source_interface)?.up) issue("mqtt.source_interface", "Select an up managed interface", page);
    }
  }
  if (config.dynamic_dns?.length) {
    const page = "/settings/dynamic-dns", targets = new Set<string>(), uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (config.dynamic_dns.length > 32) issue("dynamic_dns", "At most 32 Dynamic DNS entries", page);
    config.dynamic_dns.forEach((entry, index) => {
      const path = `dynamic_dns.${index}`;
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(entry.name)) issue(`${path}.name`, "Use 1..64 letters, digits, underscore or hyphen", page);
      else if (config.dynamic_dns!.findIndex(other => other.name === entry.name) !== index) issue(`${path}.name`, "Duplicate entry name", page);
      if (!uuid.test(entry.tenant_id)) issue(`${path}.tenant_id`, "Use a tenant UUID", page);
      if (!uuid.test(entry.client_id)) issue(`${path}.client_id`, "Use a client UUID", page);
      if (!/^\/subscriptions\/[^/\s]+\/resourceGroups\/[^/\s]+\/providers\/Microsoft\.Network\/dnszones\/[^/\s]+$/i.test(entry.zone_resource_id)) {
        issue(`${path}.zone_resource_id`, "Use the exact Azure public DNS zone resource ID", page);
      }
      if (!/^(@|[a-z0-9_-]{1,63}(\.[a-z0-9_-]{1,63})*)$/.test(entry.record_name)) issue(`${path}.record_name`, "Use @ or a lowercase name relative to the zone, without wildcard or trailing dot", page);
      bound(entry.ttl_seconds, 30, 86400, `${path}.ttl_seconds`, page);
      bound(entry.interval_seconds, 60, 86400, `${path}.interval_seconds`, page);
      const target = `${entry.zone_resource_id.toLowerCase()}|${entry.record_name}`;
      if (targets.has(target)) issue(`${path}.record_name`, "Another entry already updates this zone record", page);
      targets.add(target);
      if (entry.enabled && !interfaces.get(entry.source_interface)?.up) issue(`${path}.source_interface`, "Select an up managed interface", page);
    });
  }
  const interfacePage = (name: string): string => `/${interfaces.get(name)?.kind === "vlan" ? "vlans" : "interfaces"}/${encodeURIComponent(name)}`;
  if (config.gateway_monitors.length > 64) issue("gateway_monitors", "At most 64 gateway monitors", "/gateway-monitors");
  const monitorNames = new Set<string>();
  const monitorSources = new Map<string, number>();
  config.gateway_monitors.forEach((monitor, index) => {
    const path = `gateway_monitors.${index}`, page = "/gateway-monitors";
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(monitor.name) || monitorNames.has(monitor.name)) issue(`${path}.name`, "Use a unique case-sensitive name, 1..32 letters, digits, underscore or hyphen", page);
    monitorNames.add(monitor.name);
    if (!validName(monitor.interface)) issue(`${path}.interface`, "Use a valid explicit interface name", page);
    if (monitor.mode !== "dhcp" && monitor.routing_table !== 254) bound(monitor.routing_table, 10000, 19999, `${path}.routing_table`, page);
    for (const [key, min, max] of [
      ["probe_interval_ms", 100, 60000], ["loss_timeout_ms", 100, 60000], ["window_ms", 1000, 300000],
      ["latency_threshold_ms", 1, 60000], ["loss_threshold_percent", 1, 100],
      ["rtt_variation_threshold_ms", 0, 60000], ["failure_hold_ms", 100, 60000], ["recovery_hold_ms", 100, 60000],
    ] as const) bound(monitor[key], min, max, `${path}.${key}`, page);
    if (monitor.loss_timeout_ms > 10 * monitor.probe_interval_ms) issue(`${path}.loss_timeout_ms`, "Timeout must be <= 10 probe intervals", page);
    if (monitor.window_ms < 2 * monitor.loss_timeout_ms || monitor.window_ms < 3 * monitor.probe_interval_ms || monitor.window_ms > 1024 * monitor.probe_interval_ms) {
      issue(`${path}.window_ms`, "Window must be >= 2 timeouts, >= 3 intervals and <= 1024 intervals", page);
    }
    check(path, page, () => {
      if (monitor.mode === "dhcp") {
        const link = interfaces.get(monitor.interface), target = numericAddress(monitor.target);
        if (!link || !config.dhcp_clients?.[monitor.interface]) throw new Error("DHCP monitor requires a managed DHCP-configured interface, including when disabled");
        if (monitor.enabled && !link.up) throw new Error("Enabled DHCP monitor requires an up managed interface");
        if (target.kind() !== "ipv4" || !globalUnicast(target)) throw new Error("DHCP monitor requires an IPv4 unicast probe target");
        return;
      }
      const source = numericAddress(monitor.source_address), gateway = numericAddress(monitor.gateway), target = numericAddress(monitor.target);
      if (!globalUnicast(source) || ![gateway, target].every(address => globalUnicast(address) || (address.kind() === "ipv6" && address.range() === "linkLocal"))) {
        throw new Error("Use canonical unicast IP addresses; IPv6 link-local is allowed only for gateway/target, scoped by interface");
      }
      if (source.kind() !== gateway.kind() || source.kind() !== target.kind() || monitor.source_address === monitor.gateway || monitor.source_address === monitor.target) {
        throw new Error("Source, gateway and target must share a family; gateway and target must be remote");
      }
      if (!monitor.enabled) return;
      const sourceKey = source.toString(), previousTable = monitorSources.get(sourceKey);
      if (previousTable !== undefined && previousTable !== monitor.routing_table) throw new Error("Enabled monitors sharing a source address must use the same routing table");
      monitorSources.set(sourceKey, monitor.routing_table);
      const link = interfaces.get(monitor.interface);
      if (!link?.up || !link.addresses.some(value => prefix(value, false).address.toString() === source.toString())) {
        throw new Error("Enabled monitor requires its source on an up managed interface");
      }
      const contains = (network: string, address: ipaddr.IPv4 | ipaddr.IPv6): boolean => {
        const parsed = ipaddr.parseCIDR(network);
        return parsed[0].kind() === address.kind() && address.match(parsed);
      };
      const matchingRoute = config.routes.some(route => route.enabled !== false && route.table === monitor.routing_table && route.interface === monitor.interface &&
        contains(route.destination, target) && (route.gateway === monitor.gateway || (monitor.target === monitor.gateway && !route.gateway)));
      if (!matchingRoute) throw new Error("Enabled monitor requires an enabled explicit matching route through its gateway/table; no route is auto-created");
    });
  });
  for (const name of ["ntp", "syslog"] as const) {
    const settings = config[name], path = name, page = `/services/${name}`;
    if (settings.servers.length > 8 || (settings.enabled && !settings.servers.length)) issue(`${path}.servers`, "Use 1..8 servers when enabled, at most 8 when disabled", page);
    const seen = new Set<string>();
    settings.servers.forEach((server, index) => check(`${path}.servers.${index}`, page, () => {
      const host = typeof server === "string" ? server : server.host;
      validateServerHost(host);
      const key = typeof server === "string" ? server : `${server.transport}:${server.host}:${server.port}`;
      if (seen.has(key)) throw new Error("Duplicate server destination");
      seen.add(key);
      if (typeof server !== "string" && (!Number.isInteger(server.port) || server.port < 1 || server.port > 65535 || !["udp", "tcp", "tls"].includes(server.transport))) {
        throw new Error("Select explicit transport udp/tcp/tls and integer port 1..65535");
      }
    }));
  }
  for (const [name, client] of Object.entries(config.dhcp_clients ?? {})) {
    const path = `dhcp_clients.${name}`, page = interfacePage(name);
    const link = config.interfaces.find(item => item.name === name);
    if (!link || link.kind !== "ethernet") issue(path, "DHCPv4 requires a configured Ethernet interface", page);
    if (link?.dhcp_relay.enabled) issue(path, "DHCPv4 client and relay cannot be enabled together", page);
    if (link?.addresses.some(address => { try { return prefix(address, false).family === "ipv4"; } catch { return false; } })) {
      issue(path, "DHCPv4 cannot coexist with static IPv4 addresses; static IPv6 is allowed", page);
    }
    if (client.client_id && !/^(?:[a-fA-F0-9]{2}){2,255}$/.test(client.client_id)) issue(`${path}.client_id`, "Client ID must encode 2..255 bytes as hexadecimal", page);
    if (client.hostname) check(`${path}.hostname`, page, () => {
      if (client.hostname.length > 253 || !client.hostname.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw new Error("Use a canonical hostname up to 253 characters");
    });
    bound(client.route_metric, 0, 4294967295, `${path}.route_metric`, page);
  }
  for (const [name, settings] of Object.entries(config.dns ?? {})) {
    const path = `dns.${name}`, page = interfacePage(name);
    if (!config.interfaces.some(link => link.name === name)) issue(path, "Resolver settings require a configured interface", page);
    if (settings.servers.length > 8 || new Set(settings.servers).size !== settings.servers.length) issue(`${path}.servers`, "Use at most 8 unique DNS servers", page);
    settings.servers.forEach((server, index) => check(`${path}.servers.${index}`, page, () => {
      if (!globalUnicast(numericAddress(server), true)) throw new Error("Use a canonical unicast or loopback IP literal");
    }));
    if (settings.domains.length > 32 || new Set(settings.domains.map(domain => domain.name)).size !== settings.domains.length) issue(`${path}.domains`, "Use at most 32 unique domains", page);
    settings.domains.forEach((domain, index) => check(`${path}.domains.${index}`, page, () => {
      if (domain.name === "." && domain.route_only) return;
      if (domain.name.length > 253 || !domain.name.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw new Error("Use a canonical domain; root '.' must be routing-only");
    }));
  }
  for (const [index, link] of config.interfaces.entries()) {
    const path = `interfaces.${index}`, page = interfacePage(link.name);
    if (!validName(link.name) || names.has(link.name)) issue(`${path}.name`, "Invalid or duplicate interface name", page);
    names.add(link.name);
    if (!["wan", "lan", "unassigned"].includes(link.role)) issue(`${path}.role`, "Explicitly select WAN, LAN or Unassigned; no role is inferred", page);
    if (parents.some((parent) => parent.name === link.name)) issue(`${path}.name`, "Name collides with a protected parent", page);
    bound(link.mtu, 1280, 65535, `${path}.mtu`, page);
    const seenAddresses = new Set<string>();
    link.addresses.forEach((address, i) => check(`${path}.addresses.${i}`, page, () => {
      const parsed = prefix(address, false);
      if (!globalUnicast(parsed.address) || seenAddresses.has(address)) throw new Error("Address must be unique global unicast (private addresses allowed)");
      seenAddresses.add(address);
    }));
    const relay = link.dhcp_relay, servers = new Set<string>();
    relay.servers.forEach((server, i) => check(`${path}.dhcp_relay.servers.${i}`, page, () => {
      const address = numericAddress(server);
      if (address.kind() !== "ipv4" || !globalUnicast(address) || servers.has(server)) {
        throw new Error("Use distinct canonical unicast IPv4 servers; no loopback, link-local, multicast or broadcast");
      }
      servers.add(server);
    }));
    if (relay.enabled) {
      if (!relay.servers.length) issue(`${path}.dhcp_relay.servers`, "Enabled relay requires at least one server", page);
      if (!link.up || link.kind === "wireguard") issue(`${path}.dhcp_relay.enabled`, "Enabled relay requires an administratively up Ethernet, loopback or VLAN interface", page);
      check(`${path}.dhcp_relay.enabled`, page, () => {
        const selected = selectedRelayPrefix(link)?.split("/")[0];
        if (!selected) throw new Error("Enabled relay requires a configured unicast IPv4 address");
        if (relayAddresses.has(selected)) throw new Error("Enabled relay interfaces must have distinct selected IPv4 addresses");
        relayAddresses.add(selected);
      });
    }
    const original = baseline?.interfaces.find((item) => item.name === link.name);
    if (original && original.kind !== link.kind) issue(path, "Existing interface kind cannot change; stage deletion and confirm before replacement", page);
    if (link.kind === "vlan") {
      if (original?.kind === "vlan" && stableJson(original.vlan) !== stableJson(link.vlan)) issue(`${path}.vlan`, "Existing VLAN parent and ID are immutable", page);
      bound(link.vlan.id, 1, 4094, `${path}.vlan.id`, page);
      const identity = `${link.vlan.parent}/${link.vlan.id}`;
      if (vlanIDs.has(identity)) issue(`${path}.vlan`, "Duplicate parent/ID", page);
      vlanIDs.add(identity);
      const parent = interfaces.get(link.vlan.parent) ?? parents.find((item) => item.name === link.vlan.parent && item.available);
      if (!parent || parent.kind === "wireguard") issue(`${path}.vlan.parent`, "Select a known eligible managed or available adopted parent", page);
      else if (parent.mtu !== undefined && link.mtu > parent.mtu) issue(`${path}.mtu`, "Child MTU exceeds parent MTU", page);
      const visited = new Set([link.name]);
      let ancestor = interfaces.get(link.vlan.parent);
      while (ancestor) {
        if (visited.has(ancestor.name)) { issue(`${path}.vlan.parent`, "VLAN parent cycle", page); break; }
        visited.add(ancestor.name);
        ancestor = ancestor.kind === "vlan" ? interfaces.get(ancestor.vlan.parent) : undefined;
      }
    }
    if (link.kind === "wireguard") {
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(link.wireguard.key_ref)) issue(`${path}.wireguard.key_ref`, "Use a key reference name, never a path", page);
      bound(link.wireguard.listen_port, 1, 65535, `${path}.wireguard.listen_port`, page);
      const keys = new Set<string>(), allowed = new Set<string>();
      link.wireguard.peers.forEach((peer, i) => {
        const peerPath = `${path}.wireguard.peers.${i}`;
        check(`${peerPath}.public_key`, page, () => {
          const bytes = atob(peer.public_key);
          if (bytes.length !== 32 || ![...bytes].some((byte) => byte.charCodeAt(0) !== 0) || btoa(bytes) !== peer.public_key || keys.has(peer.public_key)) throw new Error("Use a unique nonzero base64 32-byte WireGuard public key");
          keys.add(peer.public_key);
        });
        if (peer.endpoint) check(`${peerPath}.endpoint`, page, () => wireguardEndpoint(peer.endpoint!));
        bound(peer.persistent_keepalive_seconds, 0, 65535, `${peerPath}.persistent_keepalive_seconds`, page);
        const own = new Set<string>();
        peer.allowed_ips.forEach((network, j) => check(`${peerPath}.allowed_ips.${j}`, page, () => {
          prefix(network, true);
          if (own.has(network)) throw new Error("Duplicate allowed network within a peer");
          own.add(network);
          if (peer.enabled === false) return;
          if (allowed.has(network)) throw new Error("Duplicate allowed network across enabled peers");
          allowed.add(network);
        }));
      });
    }
  }
  const blackholeName = config.blackhole?.name ?? "";
  if (blackholeName && (!validName(blackholeName) || interfaces.has(blackholeName) || parents.some(parent => parent.name === blackholeName))) {
    issue("blackhole.name", "Use a valid name that no managed or adopted interface already uses", "/blackhole");
  }
  config.routes.forEach((route, index) => {
    const path = `routes.${index}`, page = "/routes";
    check(`${path}.destination`, page, () => {
      const destination = prefix(route.destination, true);
      if (route.gateway && numericAddress(route.gateway).kind() !== destination.family) throw new Error("Gateway family must match destination");
    });
    const toBlackhole = Boolean(blackholeName) && route.interface === blackholeName;
    if (!interfaces.has(route.interface) && !toBlackhole) issue(`${path}.interface`, "Select a gateway interface", page);
    if (toBlackhole && route.gateway) issue(`${path}.gateway`, "A blackhole route cannot have a gateway", page);
    if (route.table !== 254) bound(route.table, 10000, 19999, `${path}.table`, page);
    bound(route.metric, 1, 2147483647, `${path}.metric`, page);
    const key = `${route.table}/${route.destination}/${route.metric}`;
    if (routeIDs.has(key)) issue(path, "Duplicate table/destination/metric", page);
    routeIDs.add(key);
  });
  let legacyExpanded = 0;
  config.firewall.rules.forEach((rule, index) => check(`firewall.rules.${index}`, "/firewall", () => {
    const protocolFamily = firewallProtocolFamily(rule.protocol, config.ipv6_enabled !== false);
    const ports = parseFirewallPorts(rule.destination_ports);
    if (ports.length && !supportsFirewallPorts(rule.protocol)) throw new Error("Destination ports require TCP or UDP");
    legacyExpanded += Math.max(1, ports.length);
    const source = rule.source ? prefix(rule.source, true) : undefined;
    const destination = rule.destination ? prefix(rule.destination, true) : undefined;
    if (source && destination && source.family !== destination.family) throw new Error("Source and destination must have the same family");
    if (protocolFamily && [source, destination].some(network => network && network.family !== protocolFamily)) {
      throw new Error("Source and destination must match the selected protocol's address family");
    }
  }));
  if (legacyExpanded > 4096) issue("firewall.rules", "Legacy rules expand beyond 4096 entries", "/firewall");
  config.firewall.nat.masquerade.forEach((rule, index) => check(`firewall.nat.masquerade.${index}`, "/nat", () => {
    if (rule.source && prefix(rule.source, true).family !== rule.family) throw new Error("Source must match selected family");
    const link = interfaces.get(rule.out_interface);
    if (!link || !(rule.family === "ipv4" && config.dhcp_clients?.[rule.out_interface]) && !link.addresses.some((address) => prefix(address, false).family === rule.family)) throw new Error("Egress requires a managed interface address of the selected family or an IPv4 DHCP client");
  }));
  const rewrites = config.firewall.nat.destination_rewrite ?? [], rewriteKeys = new Set<string>();
  if (rewrites.length > 256) issue("firewall.nat.destination_rewrite", "At most 256 destination rewrite rules", "/firewall/nat/dnat");
  rewrites.forEach((rule, index) => check(`firewall.nat.destination_rewrite.${index}`, "/firewall/nat/dnat", () => {
    bound(rule.destination_port, 1, 65535, `firewall.nat.destination_rewrite.${index}.destination_port`, "/firewall/nat/dnat");
    if (!["tcp", "udp"].includes(rule.protocol)) throw new Error("Select TCP or UDP");
    const target = numericAddress(rule.target_address), family = target.kind();
    if (!globalUnicast(target) || (family === "ipv4" && target.toByteArray()[0]! >= 224)) throw new Error("Target must be a usable unicast address");
    const wan = interfaces.get(rule.out_interface), lan = interfaces.get(rule.target_interface);
    if (!wan?.up || wan.role !== "wan") throw new Error("Select an up managed WAN");
    if (!lan?.up || lan.role !== "lan") throw new Error("Select an up managed LAN");
    if (!(family === "ipv4" && config.dhcp_clients?.[wan.name]) && !wan.addresses.some(address => prefix(address, false).family === family)) throw new Error("WAN requires an address of the target family, or DHCPv4");
    if (config.interfaces.some(link => link.addresses.some(address => address.split("/")[0] === rule.target_address))) throw new Error("The target must be another device, not a firewall address");
    const subnets = lan.addresses.map(address => ipaddr.parseCIDR(address)).filter(network => network[0].kind() === family && target.match(network));
    if (!subnets.length) throw new Error("Target must be inside a static subnet on the selected LAN");
    if (family === "ipv4" && !subnets.some(network => {
      if (network[1] >= 31) return true;
      const address = target.toByteArray().reduce((total, byte) => total * 256 + byte, 0);
      const size = 2 ** (32 - network[1]);
      return address % size !== 0 && address % size !== size - 1;
    })) throw new Error("Target cannot be the subnet network or broadcast address");
    const key = `${wan.name}/${rule.protocol}/${rule.destination_port}/${family}`;
    if (rewriteKeys.has(key)) throw new Error("Duplicate WAN/protocol/port/family match");
    rewriteKeys.add(key);
  }));
  const input = config.firewall.input;
  if (input) {
    const page = "/firewall/input", seen = new Set<string>();
    let expanded = 1;
    if (input.interfaces.length > 32) issue("firewall.input.interfaces", "At most 32 ingress interfaces", page);
    input.interfaces.forEach((ingress, index) => {
      const path = `firewall.input.interfaces.${index}`;
      if (!validName(ingress.interface) || !interfaces.has(ingress.interface) || seen.has(ingress.interface)) {
        issue(`${path}.interface`, "Select a unique managed ingress interface", page);
      }
      seen.add(ingress.interface);
      if (ingress.rules.length > 64) issue(`${path}.rules`, "At most 64 ordered rules per interface", page);
      ingress.rules.forEach((rule, ruleIndex) => {
        const rulePath = `${path}.rules.${ruleIndex}`, ports = rule.destination_ports ?? [];
        expanded += Math.max(1, ports.length);
        let protocolFamily: "ipv4" | "ipv6" | undefined;
        check(`${rulePath}.protocol`, page, () => { protocolFamily = firewallProtocolFamily(rule.protocol, config.ipv6_enabled !== false); });
        if (rule.destination) check(`${rulePath}.destination`, page, () => {
          const destination = prefix(rule.destination!, true);
          if (protocolFamily && destination.family !== protocolFamily) throw new Error("Destination must match the selected protocol's address family");
        });
        if (ports.length > 32 || new Set(ports).size !== ports.length) issue(`${rulePath}.destination_ports`, "Use at most 32 unique destination ports", page);
        if (ports.length && !["tcp", "udp"].includes(rule.protocol ?? "")) issue(`${rulePath}.protocol`, "Destination ports require TCP or UDP", page);
        ports.forEach((port, portIndex) => bound(port, 1, 65535, `${rulePath}.destination_ports.${portIndex}`, page));
      });
    });
    if (expanded > 4096) issue("firewall.input", "Input policies expand beyond 4096 entries", page);
    if (utf8Size(JSON.stringify({ hosts: [], interfaces: normalize(config).firewall.input!.interfaces })) > 65536) {
      issue("firewall.input", "Input policy metadata exceeds 65536 bytes", page);
    }
  }
  if (config.vnstat.collector !== null && config.vnstat.collector !== undefined) {
    check("vnstat.collector", "/services/vnstat", () => endpoint(config.vnstat.collector!, true));
  }
  if (config.softflowd.length > 16) issue("softflowd", "At most 16 instances including disabled entries", "/services/netflow");
  const serviceNames = new Set<string>();
  config.softflowd.forEach((service, index) => {
    const path = `softflowd.${index}`, page = `/services/netflow/${encodeURIComponent(service.name)}`;
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(service.name) || serviceNames.has(service.name)) issue(`${path}.name`, "Invalid or duplicate instance name", page);
    serviceNames.add(service.name);
    if (!interfaces.has(service.interface) && !parents.some((parent) => parent.name === service.interface && parent.available)) issue(`${path}.interface`, "Select a managed or available adopted capture interface", page);
    check(`${path}.collector`, page, () => endpoint(service.collector, true));
    bound(service.sampling_rate, 1, 1000000, `${path}.sampling_rate`, page);
    bound(service.max_flows, 1, 1000000, `${path}.max_flows`, page);
    bound(service.snaplen, 64, 65535, `${path}.snaplen`, page);
    if (service.capture_filter && (utf8Size(service.capture_filter) > 4096 || /[\0\r\n]/.test(service.capture_filter))) issue(`${path}.capture_filter`, "Single line, no NUL, maximum 4096 UTF-8 bytes", page);
    Object.entries(service.timeouts).forEach(([name, seconds]) => {
      if (seconds !== undefined) bound(seconds, name === "general" ? 1 : 0, 604800, `${path}.timeouts.${name}`, page);
    });
  });
  if (baseline && stableJson(config.kernel) !== stableJson(baseline.kernel)) issue("kernel", "Kernel settings must be preserved unchanged; this spec does not define a kernel editor", "/config/changes");
  if (config.firewall.policies && config.firewall.rules.length) issue("firewall.rules", "Host/interface policy mode cannot be combined with legacy forwarding rules", "/firewall");
  const policies = config.firewall.policies;
  if (policies) {
    const page = "/firewall", ids = new Set<string>(), hostNames = new Set<string>(), addresses = new Set<string>(), ingressNames = new Set<string>();
    let expanded = 1;
    if (policies.hosts.length > 128) issue("firewall.policies.hosts", "At most 128 hosts", page);
    if (policies.interfaces.length > 32) issue("firewall.policies.interfaces", "At most 32 ingress interfaces", page);
    policies.hosts.forEach((host, index) => {
      const path = `firewall.policies.hosts.${index}`;
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(host.id) || ids.has(host.id)) issue(`${path}.id`, "Use a unique host ID of 1..64 letters, digits, underscores or hyphens", page);
      ids.add(host.id);
      if (!host.name.trim() || host.name !== host.name.trim() || /\p{Cc}/u.test(host.name) || utf8Size(host.name) > 80 || hostNames.has(host.name)) {
        issue(`${path}.name`, "Use a unique nonblank name of at most 80 UTF-8 bytes, without outer whitespace or controls", page);
      }
      hostNames.add(host.name);
      if (!host.addresses.length || host.addresses.length > 16) issue(`${path}.addresses`, "Use 1..16 host addresses", page);
      host.addresses.forEach((address, addressIndex) => check(`${path}.addresses.${addressIndex}`, page, () => {
        policyHostAddress(address);
        if (addresses.has(address)) throw new Error("Host addresses must be globally unique");
        addresses.add(address);
      }));
      expanded += host.addresses.length;
    });
    const validateRules = (rules: NonNullable<Config["firewall"]["policies"]>["hosts"][number]["rules"], path: string, sources: string[]) => {
      if (rules.length > 64) issue(path, "At most 64 ordered rules per host/interface", page);
      rules.forEach((rule, index) => check(`${path}.${index}`, page, () => {
        const protocolFamily = firewallProtocolFamily(rule.protocol, config.ipv6_enabled !== false);
        if (rule.destination && rule.destination_host) throw new Error("Choose a destination host or network, not both");
        if (rule.out_interface && (!validName(rule.out_interface) || !interfaces.has(rule.out_interface))) throw new Error("Select a managed egress interface");
        const ports = rule.destination_ports ?? [];
        if (ports.length > 32 || new Set(ports).size !== ports.length || ports.some(port => !Number.isInteger(port) || port < 1 || port > 65535)) throw new Error("Use at most 32 unique destination ports in 1..65535");
        if (ports.length && !["tcp", "udp"].includes(rule.protocol ?? "")) throw new Error("Destination ports require TCP or UDP");
        let destinations = [""];
        if (rule.destination_host) {
          const target = policies.hosts.find(host => host.id === rule.destination_host);
          if (!target) throw new Error("Destination host must exist");
          destinations = target.addresses;
        } else if (rule.destination) {
          prefix(rule.destination, true);
          destinations = [rule.destination.split("/")[0]!];
        }
        let matches = 0;
        for (const source of sources) for (const destination of destinations) {
          const sourceFamily = source ? numericAddress(source).kind() : undefined;
          const destinationFamily = destination ? numericAddress(destination).kind() : undefined;
          if (protocolFamily && (sourceFamily && sourceFamily !== protocolFamily || destinationFamily && destinationFamily !== protocolFamily)) continue;
          if (!sourceFamily || !destinationFamily || sourceFamily === destinationFamily) matches++;
        }
        if (!matches) throw new Error("Host rule needs a compatible source/destination address family for the selected protocol");
        expanded += matches * Math.max(1, ports.length);
      }));
    };
    policies.hosts.forEach((host, index) => validateRules(host.rules, `firewall.policies.hosts.${index}.rules`, host.addresses));
    policies.interfaces.forEach((ingress, index) => {
      const path = `firewall.policies.interfaces.${index}`;
      if (!validName(ingress.interface) || ingressNames.has(ingress.interface) ||
        !interfaces.has(ingress.interface) && !parents.some(parent => parent.name === ingress.interface)) issue(`${path}.interface`, "Select a unique managed or adopted ingress interface", page);
      ingressNames.add(ingress.interface);
      validateRules(ingress.rules, `${path}.rules`, [""]);
    });
    if (expanded > 4096) issue("firewall.policies", "Host policies expand beyond 4096 entries", page);
    if (utf8Size(JSON.stringify(normalize(config).firewall.policies)) > 65536) issue("firewall.policies", "Host policy metadata exceeds 65536 bytes", page);
  }
  return issues;
}

export function importConfig(text: string): Config {
  if (utf8Size(text) > 1_048_576) throw new Error("Import exceeds 1 MiB");
  const parsed = configSchema.parse(decodeJson(text));
  const unknown = Object.keys(parsed).filter(key => !(key in configSchema.shape));
  if (unknown.length) throw new Error(`Unrecognized configuration key(s): ${unknown.join(", ")}`);
  return cloneConfig(parsed);
}
export function requiredPermissions(diff: Difference[]): string[] {
  const permissions = new Set(["transactions.write"]);
  const map: Record<string, string> = {
    ipv6: "kernel.namespace.write",
    interfaces: "interfaces.write", routes: "routes.write",
    dhcp_clients: "interfaces.write", dns: "interfaces.write",
    firewall: "firewall.write", "firewall-policy": "firewall.write", "firewall-icmp": "firewall.write",
    "firewall-policies": "firewall.write", "firewall-input": "firewall.write", nat: "nat.write", softflowd: "softflowd.write",
    gateway_monitors: "gateway_monitors.write", ntp: "ntp.write", syslog: "syslog.write", vnstat: "vnstat.write", mdns: "mdns.write",
    mqtt: "mqtt.write", dynamic_dns: "dynamic_dns.write", blackhole: "routes.write", system: "system.write", bgp: "bgp.write", dnat: "nat.write", udp_broadcast_relay: "udp_broadcast_relay.write", sando: "sando.write",
  };
  for (const change of diff) {
    if (map[change.area]) permissions.add(map[change.area]!);
    if (change.area === "interfaces") {
      const before = change.before && typeof change.before === "object" && "wireguard" in change.before ? change.before.wireguard : undefined;
      const after = change.after && typeof change.after === "object" && "wireguard" in change.after ? change.after.wireguard : undefined;
      if (stableJson(before) !== stableJson(after)) permissions.add("wireguard.write");
    }
    if (change.area === "kernel") {
      for (const scope of ["namespace", "host"] as const) {
        const before: unknown = change.before && typeof change.before === "object" && scope in change.before ? Reflect.get(change.before, scope) : {};
        const after: unknown = change.after && typeof change.after === "object" && scope in change.after ? Reflect.get(change.after, scope) : {};
        if (stableJson(before) !== stableJson(after)) permissions.add(`kernel.${scope}.write`);
      }
    }
  }
  return [...permissions];
}
