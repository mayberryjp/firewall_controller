import {
  interfaceSchema, routeSchema, policySchema, filterSchema, masqueradeSchema, softflowdSchema, gatewayMonitorSchema, type Config,
} from "@/types/domain";
import type { Section } from "@/services/resourceForms";

export const resourceTitles: Record<Section, string> = {
  interfaces: "Interfaces", routes: "Routes", policy_rules: "Source-policy routing",
  firewall: "Firewall forwarding", nat: "NAT masquerading", softflowd: "softflowd", gateway_monitors: "Gateway monitors",
};
export const resourceDescriptions: Record<Section, string> = {
  interfaces: "Administrative up is not carrier/readiness. WAN/LAN/Unassigned roles are descriptive metadata, not automatic NAT/firewall/routing. VLAN identity is immutable. All edits stage into one complete shared draft.",
  routes: "Unicast routes owned under protocol 242 and table 254 (main) or 10000..19999. No protected parents.",
  policy_rules: "Source-prefix table lookup only. Unique priority; multiple rules may share a table.",
  firewall: "Forwarding rule order is significant. The global IPv4 ICMP exception also covers owned input/output chains; it is not management-listener access control.",
  nat: "Masquerading does not enable forwarding, create routes, or bypass filter rules. Order is preserved.",
  softflowd: "Runtime responsiveness is not delivery verification. Reconcile affects all managed services using stored configuration, never the local draft.",
  gateway_monitors: "Native ICMP monitoring in the managed namespace, IPv4/IPv6. Explicit source/interface/gateway/target/table; no inferred WAN, automatic routing, firewall exceptions or failover. Disabled settings are retained and validated.",
};
export const resourceColumns: Record<Section, string[]> = {
  interfaces: ["name", "kind", "role", "up", "mtu", "addresses"],
  routes: ["destination", "gateway", "interface", "table", "metric"],
  policy_rules: ["priority", "source", "table"],
  firewall: ["source", "destination", "action"],
  nat: ["family", "source", "out_interface"],
  softflowd: ["name", "enabled", "interface", "collector", "export_version"],
  gateway_monitors: ["name", "enabled", "interface", "source_address", "gateway", "target", "routing_table"],
};
export function resourceItems(config: Config, section: Section): unknown[] {
  if (section === "firewall") return config.firewall.rules;
  if (section === "nat") return config.firewall.nat.masquerade;
  return config[section];
}
export function replaceResourceItems(config: Config, section: Section, values: unknown[]): void {
  switch (section) {
    case "interfaces": config.interfaces = values.map(value => interfaceSchema.parse(value)); break;
    case "routes": config.routes = values.map(value => routeSchema.parse(value)); break;
    case "policy_rules": config.policy_rules = values.map(value => policySchema.parse(value)); break;
    case "firewall": config.firewall.rules = values.map(value => filterSchema.parse(value)); break;
    case "nat": config.firewall.nat.masquerade = values.map(value => masqueradeSchema.parse(value)); break;
    case "softflowd": config.softflowd = values.map(value => softflowdSchema.parse(value)); break;
    case "gateway_monitors": config.gateway_monitors = values.map(value => gatewayMonitorSchema.parse(value)); break;
  }
}
export function displayResourceValue(value: unknown, key: string): string {
  if (value === undefined || value === null || value === "") return ["source", "destination"].includes(key) ? "Any" : key === "gateway" ? "Direct" : "—";
  if (key === "up" && typeof value === "boolean") return value ? "Up" : "Down";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length ? value.map(item => displayResourceValue(item, key)).join(", ") : "None";
  if (key === "role" && typeof value === "string") return ({ wan: "WAN", lan: "LAN", unassigned: "Unassigned" } as Record<string, string>)[value] ?? value;
  if (key === "kind" && typeof value === "string") return ({ vlan: "VLAN", wireguard: "WireGuard" } as Record<string, string>)[value] ?? value.charAt(0).toUpperCase() + value.slice(1);
  if (typeof value === "object") return Object.entries(value).map(([name, entry]) => `${name.replaceAll("_", " ")}: ${displayResourceValue(entry, name)}`).join("; ") || "None";
  return String(value);
}