import ipaddr from "ipaddr.js";
import { udpBroadcastRelaySchema, type Config, type ManagedInterface } from "@/types/domain";
import type { ValidationIssue } from "@/services/configuration";

export function eligibleUDPRelayInterface(config: Config, link: ManagedInterface): boolean {
  if (!link.up || !["ethernet", "vlan"].includes(link.kind) || link.name === "lo") return false;
  return Boolean(config.dhcp_clients?.[link.name]) || link.addresses.some(value => {
    try { const [address, bits] = ipaddr.parseCIDR(value); return address.kind() === "ipv4" && bits <= 30; }
    catch { return false; }
  });
}

export function validateUDPRelay(config: Config): ValidationIssue[] {
  if (!config.udp_broadcast_relay) return [];
  const page = "/services/udp-broadcast-relay", issues: ValidationIssue[] = [];
  const issue = (path: string, message: string) => issues.push({ path: `udp_broadcast_relay.${path}`, message, page });
  const parsed = udpBroadcastRelaySchema.safeParse(config.udp_broadcast_relay);
  if (!parsed.success) return parsed.error.issues.map(value => ({ path: `udp_broadcast_relay.${value.path.join(".")}`, message: value.message, page }));
  const relay = parsed.data, ids = new Set<number>(), ports = new Set<number>();
  if (relay.enabled && !relay.instances.some(instance => instance.enabled)) issue("enabled", "Enabled UDP Broadcast Relay requires an enabled instance");
  relay.instances.forEach((instance, index) => {
    const path = `instances.${index}`;
    if (ids.has(instance.id)) issue(`${path}.id`, "Relay IDs must be unique");
    if (ports.has(instance.port)) issue(`${path}.port`, "Relay ports must be unique, including disabled instances");
    ids.add(instance.id); ports.add(instance.port);
    if (new Set(instance.interfaces).size !== instance.interfaces.length) issue(`${path}.interfaces`, "Select each interface only once");
    for (const name of instance.interfaces) {
      const link = config.interfaces.find(value => value.name === name);
      if (!link || !eligibleUDPRelayInterface(config, link)) issue(`${path}.interfaces`, `${name} must be an up Ethernet/VLAN link with IPv4 prefix <=30 or DHCP`);
    }
    if (!relay.enabled || !instance.enabled) return;
    if (instance.port === 5353 && config.mdns?.enabled) issue(`${path}.port`, "Port 5353 conflicts with enabled mDNS");
    if (instance.port === 67 && config.interfaces.some(link => link.dhcp_relay.enabled)) issue(`${path}.port`, "Port 67 conflicts with enabled DHCP relay");
    if (instance.port === 68 && Object.keys(config.dhcp_clients ?? {}).length) issue(`${path}.port`, "Port 68 conflicts with DHCP clients");
  });
  return issues;
}

export const udpRelaySourceChoices = [
  { title: "Original source IP and port", value: "original" },
  { title: "Outgoing interface IP, original port", value: "interface_address" },
  { title: "Outgoing interface IP and relay port", value: "interface_address_and_port" },
];