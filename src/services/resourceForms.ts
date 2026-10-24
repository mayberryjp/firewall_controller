import type { Field } from "@/types/forms";
import { timeoutNames } from "@/types/domain";

export type Section = "interfaces" | "routes" | "policy_rules" | "firewall" | "nat" | "softflowd" | "gateway_monitors";
const choices = (values: Array<string | number>) => values.map(value => ({ title: String(value), value }));
const text = (key: string, label: string, hint?: string): Field => ({ key, label, kind: "text", hint });
const number = (key: string, label: string, hint?: string): Field => ({ key, label, kind: "number", hint });
const select = (key: string, label: string, values: Array<string | number>, hint?: string): Field => ({ key, label, kind: "select", choices: choices(values), hint });
export function resourceFields(section: Section, managed: string[], parents: string[], immutable: boolean, kind: unknown, family: unknown, familyInterfaces: string[]): Field[] {
  switch (section) {
    case "gateway_monitors": return [
      text("name", "Monitor name", "Unique case-sensitive name, 1..32 letters, digits, underscore/hyphen; maximum 64 monitors."),
      { key: "enabled", label: "Desired monitoring enabled", kind: "switch" },
      text("interface", "Explicit managed interface", `Available: ${managed.join(", ") || "none"}. Disabled settings may refer to absent links.`),
      text("source_address", "Numeric source address", "Must be configured on the selected up interface when enabled. No WAN/LAN inference."),
      text("gateway", "Numeric gateway", "Same family; IPv6 link-local is scoped by selected interface, not a zone suffix."),
      text("target", "Numeric probe target", "Same family; source cannot equal target or gateway."),
      number("routing_table", "Routing table", "254 (main) or 10000..19999. Stage matching routes and source-policy rules separately."),
      number("probe_interval_ms", "Probe interval (ms)", "100..60000; default 1000"),
      number("loss_timeout_ms", "Loss timeout (ms)", "100..60000, <=10 intervals; default 2000"),
      number("window_ms", "Rolling window (ms)", "1000..300000, >=2 timeouts, >=3 and <=1024 intervals; default 30000"),
      number("latency_threshold_ms", "Mean RTT degradation threshold (ms)", "1..60000; default 150"),
      number("loss_threshold_percent", "Loss degradation threshold (%)", "1..100; default 20"),
      number("rtt_variation_threshold_ms", "RTT variation threshold (ms)", "0..60000; 0 disables this threshold"),
      number("failure_hold_ms", "Failure hold (ms)", "100..60000; default 3000"),
      number("recovery_hold_ms", "Recovery hold (ms)", "100..60000; default 5000"),
    ];
    case "interfaces": return [
      { ...text("name", "Interface name", "Rename is a delete/create; review all references. 1..15 characters."), disabled: kind === "ethernet" },
      { ...select("kind", "Kind", kind === "ethernet" ? ["ethernet"] : ["dummy", "vlan", "wireguard"]), disabled: immutable || kind === "ethernet" },
      { key: "role", label: "Required interface role", kind: "select", choices: [{ title: "WAN", value: "wan" }, { title: "LAN", value: "lan" }, { title: "Unassigned", value: "unassigned" }],
        hint: "Explicit metadata only; no NAT, firewall or routing is configured. VLAN roles are not inherited." },
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
        { key: "servers", label: "DNS server IP addresses", kind: "lines", hint: "Up to 8 unique numeric IPv4/IPv6 addresses." },
        { key: "domains", label: "Resolver domains", kind: "rows", create: () => ({ name: "", route_only: false }), fields: [
          text("name", "Domain name"), { key: "route_only", label: "Routing-only domain", kind: "switch" },
        ] },
      ] },
      { key: "dhcp_relay", label: "DHCPv4 relay", kind: "object", fields: [
        { key: "enabled", label: "Enable DHCPv4 relay", kind: "switch", hint: "Requires an up Ethernet/dummy/VLAN with static IPv4; no DHCP client or WireGuard." },
        { key: "servers", label: "DHCPv4 relay servers", kind: "lines",
          hint: "One canonical numeric unicast IPv4 per line. All servers receive requests, not failover. Lists remain validated and preserved when disabled." },
      ] },
      ...(kind === "vlan" ? [{
        key: "vlan", label: "VLAN settings", kind: "object" as const, fields: [
          { ...select("parent", "Parent (adopted parents are protected)", [...managed, ...parents]), disabled: immutable },
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
              text("endpoint", "Optional numeric endpoint", "Numeric IP:port, IPv6 bracketed. No DNS or zones."),
              { key: "allowed_ips", label: "Allowed networks", kind: "lines" as const },
              number("persistent_keepalive_seconds", "Keepalive seconds", "0..65535; 0 disables keepalive."),
            ],
          },
        ],
      }] : []),
    ];
    case "routes": return [
      text("destination", "Destination network"), text("gateway", "Optional gateway", "Blank means a direct route, not 0.0.0.0."),
      select("interface", "Managed draft interface", managed), number("table", "Table", "254 (main) or 10000..19999; protocol 242 ownership is not editable."),
      number("metric", "Metric", "1..2147483647"),
    ];
    case "policy_rules": return [number("priority", "Unique priority", "10000..19999"), text("source", "Source network"), number("table", "Lookup table", "254 (main) or 10000..19999; reuse across rules is allowed.")];
    case "firewall": return [text("source", "Source network (blank = Any)"), text("destination", "Destination network (blank = Any)"), select("action", "Action", ["accept", "drop"])];
    case "nat": return [
      select("family", "Family", ["ipv4", "ipv6"]), text("source", "Source network (blank = Any)", `Must match ${String(family)}.`),
      select("out_interface", "Managed egress with family address", familyInterfaces, "IPv4 supports a static address or DHCP client; IPv6 requires a static address."),
    ];
    case "softflowd": return [
      text("name", "Instance name", "1..32 letters, digits, underscore or hyphen; maximum 16 instances including disabled."),
      { key: "enabled", label: "Desired enabled", kind: "switch" },
      select("interface", "Capture interface (adopted parents protected)", [...managed, ...parents]),
      text("collector", "Collector numeric IP:port", "Unicast/loopback; IPv6 bracketed; no DNS or zones."),
      select("export_version", "Export version (10 = IPFIX)", [1, 5, 9, 10]),
      number("sampling_rate", "Sampling rate", "1..1000000; 1 = unsampled"), number("max_flows", "Maximum flows", "1..1000000"),
      number("snaplen", "Snap length bytes", "64..65535"), { key: "promiscuous", label: "Promiscuous capture", kind: "switch" },
      text("capture_filter", "Optional single-line capture filter", "Maximum 4096 UTF-8 bytes; compilation is server-side."),
      { key: "timeouts", label: "Optional timeout overrides (blank = executable default)", kind: "object",
        fields: timeoutNames.map(name => number(name, `${name} seconds`, name === "general" ? "1..604800 or blank" : "0..604800 or blank")) },
    ];
  }
}
export function preset(section: Section, wireguard = false): unknown {
  switch (section) {
    case "gateway_monitors": return {
      name: "", enabled: false, interface: "", source_address: "", gateway: "", target: "", routing_table: 10000,
      probe_interval_ms: 1000, loss_timeout_ms: 2000, window_ms: 30000, latency_threshold_ms: 150,
      loss_threshold_percent: 20, rtt_variation_threshold_ms: 0, failure_hold_ms: 3000, recovery_hold_ms: 5000,
    };
    case "interfaces": return wireguard
      ? { name: "", kind: "wireguard", mtu: 1420, up: false, addresses: [], dhcp_relay: { enabled: false, servers: [] }, wireguard: { key_ref: "", listen_port: 51820, peers: [] } }
      : { name: "", kind: "dummy", mtu: 1500, up: false, addresses: [], dhcp_relay: { enabled: false, servers: [] } };
    case "routes": return { destination: "", interface: "", table: 10000, metric: 1 };
    case "policy_rules": return { priority: 10000, source: "", table: 10000 };
    case "firewall": return { action: "accept" };
    case "nat": return { family: "ipv4", out_interface: "" };
    case "softflowd": return {
      name: "", enabled: false, interface: "", collector: "", export_version: 9, sampling_rate: 1,
      max_flows: 8192, snaplen: 128, promiscuous: false, timeouts: {},
    };
  }
}
