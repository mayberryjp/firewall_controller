import ipaddr from "ipaddr.js";
import { configSchema, type Config, type ManagedInterface, type ParentInterface, type RepairService } from "@/types/domain";
import { decodeJson, utf8Size } from "@/services/json";

export const cloneConfig = (config: Config): Config => JSON.parse(JSON.stringify(config)) as Config;
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function normalize(config: Config): Config {
  const result = cloneConfig(config);
  for (const area of ["dhcp_clients", "dns"] as const) {
    if (!Object.keys(result[area] ?? {}).length) delete result[area];
  }
  for (const settings of Object.values(result.dns ?? {})) {
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
        if (!peer.endpoint) delete peer.endpoint;
      }
    }
  }
  result.routes.sort((a, b) => `${a.table}/${a.destination}/${a.metric}`.localeCompare(`${b.table}/${b.destination}/${b.metric}`));
  result.routes.forEach((route) => { if (!route.gateway) delete route.gateway; });
  result.policy_rules.sort((a, b) => a.priority - b.priority);
  result.softflowd.sort((a, b) => a.name.localeCompare(b.name));
  result.softflowd.forEach((service) => { if (!service.capture_filter) delete service.capture_filter; });
  result.gateway_monitors.sort((a, b) => a.name.localeCompare(b.name));
  result.ntp.servers.sort();
  result.syslog.servers.sort((a, b) => {
    const first = `${a.transport}:${a.host}:${a.port}`, second = `${b.transport}:${b.host}:${b.port}`;
    return first < second ? -1 : first > second ? 1 : 0;
  });
  for (const rule of [...result.firewall.rules, ...result.firewall.nat.masquerade]) {
    if (!rule.source) delete rule.source;
    if ("destination" in rule && !rule.destination) delete rule.destination;
  }
  if (result.firewall.policies) {
    result.firewall.policies.hosts.sort((a, b) => a.id.localeCompare(b.id));
    result.firewall.policies.interfaces.sort((a, b) => a.interface.localeCompare(b.interface));
    for (const host of result.firewall.policies.hosts) host.addresses.sort();
    for (const item of [...result.firewall.policies.hosts, ...result.firewall.policies.interfaces]) {
      for (const rule of item.rules) {
        rule.destination_ports?.sort((a, b) => a - b);
        for (const key of ["destination", "destination_host", "protocol"] as const) if (!rule[key]) delete rule[key];
        if (!rule.destination_ports?.length) delete rule.destination_ports;
      }
    }
  } else delete result.firewall.policies;
  return result;
}
export const equalConfig = (a: Config, b: Config): boolean => stableJson(normalize(a)) === stableJson(normalize(b));

export interface Difference {
  area: string; identity: string; kind: "added" | "deleted" | "modified" | "moved";
  before?: unknown; after?: unknown;
}
export function differences(before: Config, after: Config): Difference[] {
  const old = normalize(before), next = normalize(after);
  const result: Difference[] = [];
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
  named("policy-rules", old.policy_rules, next.policy_rules, (item) => String(item.priority));
  named("softflowd", old.softflowd, next.softflowd, (item) => item.name);
  named("gateway_monitors", old.gateway_monitors, next.gateway_monitors, item => item.name);
  for (const area of ["ntp", "syslog", "vnstat"] as const) {
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
  ordered("nat", old.firewall.nat.masquerade, next.firewall.nat.masquerade);
  if (stableJson(old.kernel) !== stableJson(next.kernel)) result.push({
    area: "kernel", identity: "preserved settings", kind: "modified", before: old.kernel, after: next.kernel,
  });
  return result;
}

export function numericAddress(text: string): ipaddr.IPv4 | ipaddr.IPv6 {
  if (text.includes("%") || !ipaddr.isValid(text)) throw new Error("Use a numeric IP without a zone");
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
export function endpoint(text: string, collector = false): void {
  const match = /^(\[[^\]]+\]|[^:]+):([1-9]\d*)$/.exec(text);
  if (!match?.[1] || !match[2]) throw new Error("Use numeric IP:port; bracket IPv6");
  const host = match[1].replace(/^\[|\]$/g, "");
  const address = numericAddress(host);
  if (Number(match[2]) > 65535) throw new Error("Port must be 1..65535");
  if ((address.kind() === "ipv6") !== match[1].startsWith("[")) throw new Error("Bracket IPv6 only");
  if (collector && !globalUnicast(address, true)) throw new Error("Collector must be unicast or loopback");
}
export interface ValidationIssue { path: string; message: string; page: string }
export function validateConfig(config: Config, parents: ParentInterface[] = [], baseline?: Config): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const issue = (path: string, message: string, page: string) => issues.push({ path, message, page });
  function check(path: string, page: string, action: () => void): void {
    try { action(); } catch (error) { issue(path, error instanceof Error ? error.message : "Invalid value", page); }
  }
  function bound(value: number, min: number, max: number, path: string, page: string): void {
    if (!Number.isInteger(value) || value < min || value > max) issue(path, `Must be an integer ${min}..${max}`, page);
  }
  const names = new Set<string>(), vlanIDs = new Set<string>(), routeIDs = new Set<string>(), priorities = new Set<number>(), relayAddresses = new Set<string>();
  const validName = (name: string) => /^[a-zA-Z0-9_.-]{1,15}$/.test(name) && !["lo", ".", ".."].includes(name);
  const interfaces = new Map(config.interfaces.map((link) => [link.name, link]));
  if (config.gateway_monitors.length > 64) issue("gateway_monitors", "At most 64 gateway monitors", "/gateway-monitors");
  const monitorNames = new Set<string>();
  config.gateway_monitors.forEach((monitor, index) => {
    const path = `gateway_monitors.${index}`, page = "/gateway-monitors";
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(monitor.name) || monitorNames.has(monitor.name)) issue(`${path}.name`, "Use a unique case-sensitive name, 1..32 letters, digits, underscore or hyphen", page);
    monitorNames.add(monitor.name);
    if (!validName(monitor.interface)) issue(`${path}.interface`, "Use a valid explicit interface name", page);
    if (monitor.routing_table !== 254) bound(monitor.routing_table, 10000, 19999, `${path}.routing_table`, page);
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
      const source = numericAddress(monitor.source_address), gateway = numericAddress(monitor.gateway), target = numericAddress(monitor.target);
      if (!globalUnicast(source) || ![gateway, target].every(address => globalUnicast(address) || (address.kind() === "ipv6" && address.range() === "linkLocal"))) {
        throw new Error("Use canonical unicast numeric addresses; IPv6 link-local is allowed only for gateway/target, scoped by interface");
      }
      if (source.kind() !== gateway.kind() || source.kind() !== target.kind() || monitor.source_address === monitor.gateway || monitor.source_address === monitor.target) {
        throw new Error("Source, gateway and target must share a family; gateway and target must be remote");
      }
      if (!monitor.enabled) return;
      const link = interfaces.get(monitor.interface);
      if (!link?.up || !link.addresses.some(value => prefix(value, false).address.toString() === source.toString())) {
        throw new Error("Enabled monitor requires its source on an up managed interface");
      }
      const contains = (network: string, address: ipaddr.IPv4 | ipaddr.IPv6): boolean => {
        const parsed = ipaddr.parseCIDR(network);
        return parsed[0].kind() === address.kind() && address.match(parsed);
      };
      const matchingRoute = config.routes.some(route => route.table === monitor.routing_table && route.interface === monitor.interface &&
        contains(route.destination, target) && (route.gateway === monitor.gateway || (monitor.target === monitor.gateway && !route.gateway)));
      const matchingRule = config.policy_rules.some(rule => rule.table === monitor.routing_table && contains(rule.source, source));
      if (!matchingRoute || !matchingRule) throw new Error("Enabled monitor requires an explicit matching route through its gateway/table and source-policy rule; nothing is auto-created");
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
    const path = `dhcp_clients.${name}`, page = `/interfaces/${encodeURIComponent(name)}`;
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
    const path = `dns.${name}`, page = `/interfaces/${encodeURIComponent(name)}`;
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
    const path = `interfaces.${index}`, page = `/interfaces/${encodeURIComponent(link.name)}`;
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
      if (!link.up || link.kind === "wireguard") issue(`${path}.dhcp_relay.enabled`, "Enabled relay requires an administratively up Ethernet, dummy or VLAN interface", page);
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
        if (peer.endpoint) check(`${peerPath}.endpoint`, page, () => endpoint(peer.endpoint!));
        bound(peer.persistent_keepalive_seconds, 0, 65535, `${peerPath}.persistent_keepalive_seconds`, page);
        peer.allowed_ips.forEach((network, j) => check(`${peerPath}.allowed_ips.${j}`, page, () => {
          prefix(network, true);
          if (allowed.has(network)) throw new Error("Duplicate allowed network across peers");
          allowed.add(network);
        }));
      });
    }
  }
  config.routes.forEach((route, index) => {
    const path = `routes.${index}`, page = "/routes";
    check(`${path}.destination`, page, () => {
      const destination = prefix(route.destination, true);
      if (route.gateway && numericAddress(route.gateway).kind() !== destination.family) throw new Error("Gateway family must match destination");
    });
    if (!interfaces.has(route.interface)) issue(`${path}.interface`, "Select a managed draft interface", page);
    if (route.table !== 254) bound(route.table, 10000, 19999, `${path}.table`, page);
    bound(route.metric, 1, 2147483647, `${path}.metric`, page);
    const key = `${route.table}/${route.destination}/${route.metric}`;
    if (routeIDs.has(key)) issue(path, "Duplicate table/destination/metric", page);
    routeIDs.add(key);
  });
  config.policy_rules.forEach((rule, index) => {
    const path = `policy_rules.${index}`, page = "/policy-rules";
    check(`${path}.source`, page, () => { prefix(rule.source, true); });
    bound(rule.priority, 10000, 19999, `${path}.priority`, page);
    if (rule.table !== 254) bound(rule.table, 10000, 19999, `${path}.table`, page);
    if (priorities.has(rule.priority)) issue(`${path}.priority`, "Priority must be unique", page);
    priorities.add(rule.priority);
  });
  config.firewall.rules.forEach((rule, index) => check(`firewall.rules.${index}`, "/firewall", () => {
    const source = rule.source ? prefix(rule.source, true) : undefined;
    const destination = rule.destination ? prefix(rule.destination, true) : undefined;
    if (source && destination && source.family !== destination.family) throw new Error("Source and destination must have the same family");
  }));
  config.firewall.nat.masquerade.forEach((rule, index) => check(`firewall.nat.masquerade.${index}`, "/nat", () => {
    if (rule.source && prefix(rule.source, true).family !== rule.family) throw new Error("Source must match selected family");
    const link = interfaces.get(rule.out_interface);
    if (!link || !link.addresses.some((address) => prefix(address, false).family === rule.family)) throw new Error("Egress requires a managed interface address of the selected family");
  }));
  if (config.softflowd.length > 16) issue("softflowd", "At most 16 instances including disabled entries", "/services/softflowd");
  const serviceNames = new Set<string>();
  config.softflowd.forEach((service, index) => {
    const path = `softflowd.${index}`, page = `/services/softflowd/${encodeURIComponent(service.name)}`;
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
  if (baseline && stableJson(config.kernel) !== stableJson(baseline.kernel)) issue("kernel", "Kernel settings must be preserved unchanged; this spec does not define a kernel editor", "/changes");
  if (config.firewall.policies && config.firewall.rules.length) issue("firewall.rules", "Host/interface policy mode cannot be combined with legacy forwarding rules", "/firewall");
  if (baseline && stableJson(normalize(config).firewall.policies) !== stableJson(normalize(baseline).firewall.policies)) {
    issue("firewall.policies", "Host/interface policies are read-only in this controller; preserve them unchanged", "/firewall");
  }
  return issues;
}

export function importConfig(text: string): Config {
  if (utf8Size(text) > 1_048_576) throw new Error("Import exceeds 1 MiB");
  return configSchema.parse(decodeJson(text));
}
export function requiredPermissions(diff: Difference[]): string[] {
  const permissions = new Set(["transactions.write"]);
  const map: Record<string, string> = {
    interfaces: "interfaces.write", routes: "routes.write", "policy-rules": "policy.write",
    dhcp_clients: "interfaces.write", dns: "interfaces.write",
    firewall: "firewall.write", "firewall-policy": "firewall.write", "firewall-icmp": "firewall.write",
    "firewall-policies": "firewall.write", nat: "nat.write", softflowd: "softflowd.write",
    gateway_monitors: "gateway_monitors.write", ntp: "ntp.write", syslog: "syslog.write", vnstat: "vnstat.write",
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
