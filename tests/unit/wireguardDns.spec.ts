import { describe, expect, it } from "vitest";
import { cloneConfig, differences, endpoint, importConfig, normalize, validateConfig, wireguardEndpoint } from "@/services/configuration";
import { isWireGuardDnsEndpoint } from "@/services/wireguard";
import { configSchema, peerSchema, runtimeSchema, stateSchema, wireguardDnsSchema } from "@/types/domain";
import { config, runtime, state, wireguardDns } from "../fixtures";

function configured(value: string) {
  const candidate = config();
  const tunnel = {
    name: "wg0", kind: "wireguard" as const, role: "wan" as const, mtu: 1420, up: true, addresses: [],
    dhcp_relay: { enabled: false, servers: [] },
    wireguard: { key_ref: "key", listen_port: 51820, peers: [{
      public_key: btoa("\x01".repeat(32)), endpoint: value, allowed_ips: ["10.0.0.0/24"], persistent_keepalive_seconds: 25,
    }] },
  };
  candidate.interfaces.push(tunnel);
  return { candidate, tunnel };
}

describe("WireGuard DNS endpoints", () => {
  const maxHost = [...Array<string>(3).fill("a".repeat(63)), "a".repeat(61)].join(".");
  it.each([
    "", "vpn.example.test:51820", "localhost:1", "vpn-1.example:65535", `${maxHost}:51820`,
    "192.0.2.1:51820", "127.0.0.1:1", "[2001:db8::1]:51820", "[::1]:65535",
  ])("accepts and preserves %s without browser resolution", value => {
    const { candidate } = configured(value);
    expect(() => wireguardEndpoint(value)).not.toThrow();
    expect(validateConfig(candidate)).toEqual([]);
    for (const result of [cloneConfig(candidate), normalize(candidate), importConfig(JSON.stringify(candidate)), configSchema.parse(candidate)]) {
      const tunnel = result.interfaces[1];
      if (tunnel?.kind !== "wireguard") throw new Error("Missing test tunnel");
      expect(tunnel.wireguard.peers[0]?.endpoint || "").toBe(value);
    }
    expect(differences(candidate, cloneConfig(candidate))).toEqual([]);
  });
  it.each([
    "VPN.example:51820", "vpn.example.:51820", "vpn_example:51820", "-vpn.example:51820",
    "vpn-.example:51820", "vpn..example:51820", "https://vpn.example:51820", "vpn.example/path:51820",
    " vpn.example:51820", "vpn.example :51820", "vpn.example:51820 ", "vpn.example:0", "vpn.example:65536",
    "vpn.example:051820", "vpn.example:+1", "vpn.example:1.0", "vpn.example:wg", "vpn.example",
    `${"a".repeat(64)}.example:51820`, `${maxHost}a:51820`, "v\u00e9pn.example:51820",
    "192.0.2.999:51820", "123:51820", "2001:db8::1:51820", "[vpn.example]:51820",
    "[::ffff:192.0.2.1]:51820", "[fe80::1%eth0]:51820", "0.0.0.0:51820", "[::]:51820",
    "224.0.0.1:51820", "[ff02::1]:51820",
  ])("rejects invalid endpoint %s", value => {
    expect(() => wireguardEndpoint(value)).toThrow();
    const { candidate } = configured(value);
    expect(validateConfig(candidate).some(issue => issue.path === "interfaces.1.wireguard.peers.0.endpoint")).toBe(true);
  });
  it.each([null, 51820, {}, []])("rejects non-string endpoint %j", value => {
    const { tunnel } = configured("");
    expect(peerSchema.safeParse({ ...tunnel.wireguard.peers[0], endpoint: value }).success).toBe(false);
  });
  it("allows DNS with IPv6 disabled but still rejects numeric IPv6", () => {
    const { candidate, tunnel } = configured("vpn.example.test:51820");
    candidate.ipv6_enabled = false;
    candidate.interfaces.forEach(link => { link.addresses = link.addresses.filter(address => !address.includes(":")); });
    expect(validateConfig(candidate)).toEqual([]);
    tunnel.wireguard.peers[0]!.endpoint = "[2001:db8::1]:51820";
    expect(validateConfig(candidate).some(issue => issue.path === "interfaces.1.wireguard.peers.0.endpoint")).toBe(true);
  });
  it("leaves numeric-only collector validation unchanged", () => {
    expect(() => endpoint("vpn.example.test:51820", true)).toThrow();
    expect(() => endpoint("192.0.2.1:51820", true)).not.toThrow();
  });
  it.each([
    ["vpn.example.test:51820", true], ["localhost:1", true], ["192.0.2.1:51820", false],
    ["[2001:db8::1]:51820", false], ["", false], [undefined, false],
  ] as const)("identifies DNS endpoint %s as %s", (value, expected) => {
    expect(isWireGuardDnsEndpoint(value)).toBe(expected);
  });
});

describe("native WireGuard DNS measurements", () => {
  it("decodes both state and runtime measurements without losing native runtime fields", () => {
    const dns = wireguardDns();
    expect(stateSchema.parse({ ...state(), runtime: { wireguard_dns: dns, native_marker: true } }).runtime)
      .toEqual({ wireguard_dns: dns, native_marker: true });
    expect(runtimeSchema.parse({ ...runtime(), wireguard_dns: dns }).wireguard_dns).toEqual(dns);
    expect(stateSchema.parse(state()).runtime).toBeUndefined();
    expect(runtimeSchema.parse(runtime()).wireguard_dns).toBeUndefined();
    expect(wireguardDnsSchema.parse({ running: false, refresh_interval_seconds: 60, error: null, peers: [] }).peers).toEqual([]);
  });
  it.each([null, -1, 0.1, "1793386800000", Number.MAX_SAFE_INTEGER + 1])("rejects invalid last-success milliseconds %j", value => {
    const dns = wireguardDns();
    expect(wireguardDnsSchema.safeParse({ ...dns, peers: [{ ...dns.peers[0], last_success_unix_ms: value }] }).success).toBe(false);
  });
});
