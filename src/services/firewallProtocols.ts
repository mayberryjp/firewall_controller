import { z } from "zod";

export const firewallProtocolSchema = z.enum(["", "tcp", "udp", "icmp", "icmpv6"]);
export const firewallProtocolChoices = [
  { title: "Any", value: "" }, { title: "TCP", value: "tcp" }, { title: "UDP", value: "udp" },
  { title: "ICMP", value: "icmp" }, { title: "ICMPv6", value: "icmpv6" },
];
export function supportsFirewallPorts(protocol: unknown): boolean {
  return protocol === "tcp" || protocol === "udp";
}
export function formatFirewallProtocol(protocol: string | undefined): string {
  return protocol === "icmpv6" ? "ICMPv6" : protocol?.toUpperCase() || "Any";
}
export function firewallProtocolFamily(protocol: unknown, ipv6Enabled: boolean): "ipv4" | "ipv6" | undefined {
  const value = firewallProtocolSchema.parse(protocol === undefined ? "" : protocol);
  if (value === "icmpv6" && !ipv6Enabled) throw new Error("ICMPv6 requires global IPv6 to be enabled.");
  return value === "icmp" ? "ipv4" : value === "icmpv6" ? "ipv6" : undefined;
}
export function parseFirewallPorts(value: unknown): number[] {
  const parts: unknown[] = value === undefined || value === "" ? []
    : typeof value === "string" ? value.trim() ? value.trim().split(/[,\s]+/) : []
      : Array.isArray(value) ? value : [value];
  if (parts.some(port => typeof port !== "number" && (typeof port !== "string" || !/^\d+$/.test(port)))) {
    throw new Error("Destination ports must be whole numbers from 1 to 65535.");
  }
  const ports = parts.map(Number);
  if (ports.length > 32 || new Set(ports).size !== ports.length || ports.some(port => !Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new Error("Use at most 32 unique destination ports in 1..65535.");
  }
  return ports;
}
export function firewallProtocolNotice(protocol: unknown, action: unknown, allowAllIcmp: boolean): string {
  if (action !== "drop") return "";
  if (protocol === "icmpv6") return "Blocking ICMPv6 can break neighbor discovery and IPv6 error reporting.";
  if (protocol === "icmp" && allowAllIcmp) return "The global IPv4 ICMP exception accepts this traffic before configured drop rules.";
  return "";
}
