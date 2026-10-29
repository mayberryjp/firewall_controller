import type { Choice, Field } from "@/types/forms";
import { timeoutNames } from "@/types/domain";
import { displayResourceValue } from "@/services/resourceCollections";

export type Section = "interfaces" | "routes" | "firewall" | "nat" | "softflowd" | "gateway_monitors";
const text = (key: string, label: string, hint?: string): Field => ({ key, label, kind: "text", hint });
const number = (key: string, label: string, hint?: string): Field => ({ key, label, kind: "number", hint });
const select = (key: string, label: string, values: Array<string | number | Choice>, hint?: string): Field => ({
  key, label, kind: "select", choices: values.map(value => typeof value === "object" ? value :
    { title: key === "kind" ? displayResourceValue(value, key) : String(value), value }), hint,
});
export const metadataField: Field = { key: "metadata", label: "Labels", kind: "object", fields: [
  text("display_name", "Display name"), text("description", "Description"),
] };
export function metadataFields(fields: Field[], include = true): Field[] {
  const result = fields.map(field => field.fields ? { ...field, fields: metadataFields(field.fields,
    ["dhcp_client", "resolver", "domains", "peers", "interfaces", "rules", "servers"].includes(field.key)) } : field);
  return include && !result.some(field => field.key === "metadata") ? [...result, metadataField] : result;
}
export function resourceFields(...args: Parameters<typeof baseResourceFields>): Field[] {
  // Route Status owns enabled; labels stay preserved in the row but are not edited here.
  if (args[0] === "routes") return baseResourceFields(...args).filter(field => field.key !== "enabled");
  const fields = metadataFields(baseResourceFields(...args), !["nat", "softflowd"].includes(args[0]) && (!args[7] || args[8] !== false));
  return args[0] === "interfaces" ? fields.map(field => field.key === "metadata"
    ? { ...field, fields: field.fields?.filter(child => child.key !== "description") } : field) : fields;
}
function baseResourceFields(section: Section, managed: Array<string | Choice>, parents: Array<string | Choice>, immutable: boolean, kind: unknown, family: unknown, familyInterfaces: Array<string | Choice>, wireguard = false, creating = true, vlan = false): Field[] {
  switch (section) {
    case "gateway_monitors": return [
      text("name", "Monitor name", "Unique case-sensitive name, 1..32 letters, digits, underscore/hyphen; maximum 64 monitors."),
      select("interface", "Interface", managed),
      text("target", "Probe Target"),
      number("probe_interval_ms", "Probe interval (ms)", "100..60000; default 1000"),
      number("loss_timeout_ms", "Loss timeout (ms)", "100..60000, <=10 intervals; default 2000"),
      number("window_ms", "Rolling window (ms)", "1000..300000, >=2 timeouts, >=3 and <=1024 intervals; default 30000"),
      number("latency_threshold_ms", "Mean RTT degradation threshold (ms)", "1..60000; default 150"),
      number("loss_threshold_percent", "Loss degradation threshold (%)", "1..100; default 20"),
      number("rtt_variation_threshold_ms", "RTT variation threshold (ms)", "0..60000; 0 disables this threshold"),
      number("failure_hold_ms", "Failure hold (ms)", "100..60000; default 3000"),
      number("recovery_hold_ms", "Recovery hold (ms)", "100..60000; default 5000"),
    ];
    case "interfaces": return ([
      { ...text("name", "Interface name", "Rename is a delete/create; review all references. 1..15 characters."), disabled: kind === "ethernet" },
      { ...select("kind", "Kind", vlan ? ["vlan"] : wireguard || kind === "wireguard" ? ["wireguard"] : kind === "ethernet" ? ["ethernet"] : ["dummy", "vlan"]), disabled: vlan || immutable || kind === "ethernet" || kind === "wireguard" },
      ...(kind === "vlan" ? [] : [{ key: "role", label: "Required interface role", kind: "select" as const, choices: [{ title: "WAN", value: "wan" }, { title: "LAN", value: "lan" }, { title: "Unassigned", value: "unassigned" }],
        hint: "Explicit metadata only; no NAT, firewall or routing is configured." }]),
      number("mtu", "MTU", "1280..65535"), { key: "up", label: "Administratively up (not carrier readiness)", kind: "switch" },
      { key: "addresses", label: "Interface address prefixes", kind: "lines", hint: "Host bits are retained, e.g. 192.0.2.10/24. Global unicast includes private addresses." },
      ...(kind === "ethernet" ? [
        select("address_mode", "IPv4 configuration", ["static", "dhcp"]),
        { key: "dhcp_client", label: "DHCPv4 client", kind: "object" as const, fields: [
          text("client_id", "Client ID (hexadecimal)"), text("hostname", "DHCP hostname"),
          number("route_metric", "DHCP route metric", "0..4294967295"),
          { key: "use_mtu", label: "Accept DHCP MTU", kind: "switch" as const },
          select("use_domains", "DHCP domain policy", ["no", "route", "yes"]),
        ] },
      ] : []),
      { key: "resolver_enabled", label: "Configure interface resolver", kind: "switch" },
      { key: "resolver", label: "Resolver settings", kind: "object", fields: [
        { key: "servers", label: "DNS server IP addresses", kind: "lines", hint: "Up to 8 unique IPv4/IPv6 addresses." },
        { key: "domains", label: "Resolver domains", kind: "rows", create: () => ({ name: "", route_only: false }), fields: [
          text("name", "Domain name"), { key: "route_only", label: "Routing-only domain", kind: "switch" },
        ] },
      ] },
      ...(kind === "vlan" ? [{
        key: "vlan", label: "VLAN settings", kind: "object" as const, fields: [
          { ...select("parent", "Parent interface", [...managed, ...parents]), disabled: immutable },
          { ...number("id", "VLAN ID", "1..4094. Existing parent/ID cannot change in place."), disabled: immutable },
        ],
      }] : []),
      ...(kind === "wireguard" ? [{
        key: "wireguard", label: "WireGuard configuration (not connectivity telemetry)", kind: "object" as const, fields: [
          text("key_ref", "Key reference", "Operator-provisioned immutable key name, never a private key or path."),
          number("listen_port", "Stable listen port", "1..65535"),
          { key: "peers", label: "Peers", kind: "rows" as const,
            create: () => ({ public_key: "", allowed_ips: [], persistent_keepalive_seconds: 0 }),
            fields: [
              text("public_key", "Public key", "Unique nonzero base64 32-byte key. No private-key upload/generation."),
              text("endpoint", "Optional endpoint", "IP:port, IPv6 bracketed. No DNS or zones."),
              { key: "allowed_ips", label: "Allowed networks", kind: "lines" as const },
              number("persistent_keepalive_seconds", "Keepalive seconds", "0..65535; 0 disables keepalive."),
            ],
          },
        ],
      }] : []),
    ] satisfies Field[]).filter(field => wireguard ? creating ? ["name", "kind", "role", "mtu", "up", "addresses", "wireguard"].includes(field.key) : field.key === "wireguard" : field.key !== "wireguard");
    case "routes": return [
      { key: "enabled", label: "Enabled", kind: "switch" },
      text("destination", "Destination network"),
      select("interface", "Gateway interface", managed),
      number("metric", "Metric", "1..2147483647"),
    ];
    case "firewall": return [text("source", "Source network (blank = Any)"), text("destination", "Destination network (blank = Any)"), select("action", "Action", ["accept", "drop"])];
    case "nat": return [
      select("family", "Family", ["ipv4", "ipv6"]), text("source", "Source network (blank = Any)", `Must match ${String(family)}.`),
      select("out_interface", "Managed egress with family address", familyInterfaces, "IPv4 supports a static address or DHCP client; IPv6 requires a static address."),
    ];
    case "softflowd": return [
      text("name", "Instance name", "1..32 letters, digits, underscore or hyphen; maximum 16 instances including disabled."),
      select("interface", "Capture interface", [...managed, ...parents]),
      text("collector", "Collector IP:port", "Unicast/loopback; IPv6 bracketed; no DNS or zones."),
      select("export_version", "Export version", [{ title: "NetFlow v1", value: 1 }, { title: "NetFlow v5", value: 5 }, { title: "NetFlow v9", value: 9 }, { title: "IPFIX (v10)", value: 10 }]),
      number("sampling_rate", "Sampling rate", "1..1000000; 1 = unsampled"),
      number("max_flows", "Maximum flows", "1..1000000"),
      ...timeoutNames.map(name => number(`timeout_${name}`, `${name} timeout seconds (blank = default)`, name === "general" ? "1..604800 or blank" : "0..604800 or blank")),
    ];
  }
}
export function preset(section: Section, wireguard = false): unknown {
  switch (section) {
    case "gateway_monitors": return {
      name: "", enabled: true, interface: "", source_address: "", gateway: "", target: "", routing_table: 254,
      probe_interval_ms: 1000, loss_timeout_ms: 2000, window_ms: 30000, latency_threshold_ms: 150,
      loss_threshold_percent: 20, rtt_variation_threshold_ms: 0, failure_hold_ms: 3000, recovery_hold_ms: 5000,
    };
    case "interfaces": return wireguard
      ? { name: "", kind: "wireguard", mtu: 1420, up: false, addresses: [], dhcp_relay: { enabled: false, servers: [] }, wireguard: { key_ref: "", listen_port: 51820, peers: [] } }
      : { name: "", kind: "dummy", mtu: 1500, up: false, addresses: [], dhcp_relay: { enabled: false, servers: [] } };
    case "routes": return { enabled: true, destination: "", interface: "", table: 254, metric: 1 };
    case "firewall": return { action: "accept" };
    case "nat": return { family: "ipv4", out_interface: "" };
    case "softflowd": return {
      name: "", enabled: true, interface: "", collector: "", export_version: 5, sampling_rate: 1,
      max_flows: 8192, snaplen: 128, promiscuous: true, timeouts: {},
    };
  }
}
