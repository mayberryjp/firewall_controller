import type { Config, ManagedInterface, MDNSConfig } from "@/types/domain";
import type { ValidationIssue } from "@/services/configuration";

const asciiLower = (value: string) => value.replace(/[A-Z]/g, letter => letter.toLowerCase());

export function eligibleMDNSInterface(config: Config, link: ManagedInterface): boolean {
  if (!link.up || (link.kind !== "ethernet" && link.kind !== "vlan")) return false;
  return link.role === "lan" || (link.kind === "vlan" && config.interfaces.some(parent =>
    parent.name === link.vlan?.parent && parent.kind === "ethernet" && parent.up && parent.role === "lan"));
}

export function mdnsInterfaces(config: Config, settings = config.mdns): string[] {
  if (!settings) return [];
  return config.interfaces.filter(link => eligibleMDNSInterface(config, link) &&
    settings.interfaces.includes(link.name) === (settings.interface_mode === "allow"))
    .map(link => link.name).sort();
}

export function normalizeMDNS(settings: MDNSConfig): void {
  settings.interfaces.sort();
  settings.reflection.filters = settings.reflection.filters.map(asciiLower).sort();
  settings.publishing.domain = asciiLower(settings.publishing.domain);
}

function localName(value: string): boolean {
  return value.length <= 253 && /(?:^|\.)local\.$/i.test(value) &&
    value.slice(0, -1).split(".").every(label => /^[a-z0-9_-]{1,63}$/i.test(label));
}
const hostname = (value: string) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value);

export function validateMDNS(config: Config): ValidationIssue[] {
  const settings = config.mdns;
  if (!settings) return [];
  const issues: ValidationIssue[] = [];
  const issue = (path: string, message: string) => issues.push({ path: `mdns.${path}`, message, page: "/services/mdns" });
  if (settings.interfaces.length > 32 || new Set(settings.interfaces).size !== settings.interfaces.length) {
    issue("interfaces", "Use at most 32 unique interface entries.");
  }
  for (const name of settings.interfaces) {
    const link = config.interfaces.find(link => link.name === name);
    if (!link || (link.kind !== "ethernet" && link.kind !== "vlan")) {
      issue("interfaces", `${name} must be a configured Ethernet/VLAN link.`);
    } else if (settings.interface_mode === "allow" && !eligibleMDNSInterface(config, link)) {
      issue("interfaces", `${name} must be administratively up with role LAN or be a VLAN on an up LAN Ethernet parent in allow mode.`);
    }
  }
  const filters = settings.reflection.filters.map(asciiLower);
  if (filters.length > 64 || new Set(filters).size !== filters.length) {
    issue("reflection.filters", "Use at most 64 unique filters (case-insensitive).");
  }
  for (const filter of filters) {
    const labels = filter.slice(0, -1).split(".");
    const service = labels.length >= 3 && labels[0]!.startsWith("_") && ["_tcp", "_udp"].includes(labels[1]!);
    const subtype = labels.length >= 5 && labels[0]!.startsWith("_") && labels[1] === "_sub" &&
      labels[2]!.startsWith("_") && ["_tcp", "_udp"].includes(labels[3]!);
    const instance = labels.length >= 4 && labels[1]!.startsWith("_") && ["_tcp", "_udp"].includes(labels[2]!);
    const provider = labels.length >= 2 && labels.every(label => !label.includes("_"));
    if (!localName(filter) || !(service || subtype || instance || provider)) {
      issue("reflection.filters", `${filter || "(empty)"} must be an absolute local service, subtype, exact instance or provider name with a trailing dot; no patterns.`);
    }
  }
  const publishing = settings.publishing;
  if (publishing.hostname && !hostname(publishing.hostname)) {
    issue("publishing.hostname", "Use a lowercase hostname label of 1..63 letters, digits or hyphens, without edge hyphens.");
  }
  if (!localName(publishing.domain) || publishing.domain.includes("_")) {
    issue("publishing.domain", "Use local. or an absolute local subdomain without underscores, at most 253 ASCII bytes.");
  }
  if (publishing.aaaa_on_ipv4 && (!settings.ipv4 || !publishing.addresses)) {
    issue("publishing.aaaa_on_ipv4", "AAAA over IPv4 requires IPv4 transport and address publishing.");
  }
  if (publishing.a_on_ipv6 && (!settings.ipv6 || !publishing.addresses)) {
    issue("publishing.a_on_ipv6", "A over IPv6 requires IPv6 preference and address publishing.");
  }
  if (publishing.enabled) {
    if (!(publishing.addresses || publishing.hinfo || publishing.workstation || publishing.browse_domain)) {
      issue("publishing.enabled", "Enabled publishing needs at least one publication flag.");
    }
    const effective = publishing.hostname || config.system?.hostname || "";
    if (!hostname(effective)) issue("publishing.hostname", "Set an explicit hostname or a valid configured system hostname.");
    if (effective.length + publishing.domain.length >= 253) issue("publishing.domain", "Generated hostname/domain exceeds the DNS name limit.");
    if (publishing.workstation && (effective.length + "_workstation._tcp.".length + publishing.domain.length >= 253 ||
      "_services._dns-sd._udp.".length + publishing.domain.length > 253)) {
      issue("publishing.domain", "Generated workstation or enumeration name exceeds 253 bytes.");
    }
  }
  if (settings.enabled) {
    if (!settings.ipv4 && !(settings.ipv6 && config.ipv6_enabled !== false)) {
      issue("ipv4", "Enable at least one effective address family; global IPv6 off suppresses IPv6.");
    }
    if (!settings.reflection.enabled && !publishing.enabled) issue("enabled", "Enable reflection or publishing before enabling mDNS.");
    const minimum = settings.reflection.enabled ? 2 : 1, count = mdnsInterfaces(config).length;
    if (count < minimum || count > 32) issue("interfaces", `Enabled mDNS requires ${minimum}..32 eligible LAN links; currently ${count}.`);
  }
  return issues;
}
