import { describe, expect, it } from "vitest";
import { handshakeChip, learnedAllowedNetworks } from "@/services/wireguard";
import { bgpConfig, bgpRoutes } from "../bgpFixtures";

function learnedFixture() {
  const candidate = bgpConfig(), routes = bgpRoutes(), key = btoa("\x01".repeat(32));
  candidate.interfaces.push({
    name: "wg0", kind: "wireguard", role: "wan", up: true, mtu: 1420, addresses: [],
    dhcp_relay: { enabled: false, servers: [] },
    wireguard: { key_ref: "key", listen_port: 51820, peers: [{
      public_key: key, allowed_ips: ["10.0.0.0/8", "2001:db8::/32"], persistent_keepalive_seconds: 25,
    }] },
  });
  candidate.bgp!.neighbors[0]!.interface = "wg0";
  candidate.bgp!.neighbors[0]!.wireguard_public_key = key;
  routes.routes[0] = { ...routes.routes[0]!, interface: "wg0", installed: true, reason: null };
  return { candidate, routes, key };
}

describe("WireGuard learned allowed networks", () => {
  it("matches installed BGP additions by applied interface, neighbor and public key without changing configuration", () => {
    const { candidate, routes, key } = learnedFixture(), before = JSON.stringify(candidate);
    routes.routes.push({ ...routes.routes[0]! }, { ...routes.routes[0]!, prefix: "203.0.113.0/24", neighbor: "other" },
      { ...routes.routes[0]!, prefix: "192.0.2.0/24", interface: "wg1" });
    expect(learnedAllowedNetworks(candidate, routes, "wg0", key)).toEqual([{ prefix: "198.51.100.0/24", neighbor: "remote" }]);
    expect(learnedAllowedNetworks(candidate, routes, "wg0", "different-key")).toEqual([]);
    expect(JSON.stringify(candidate)).toBe(before);
  });
  it.each([
    { selected: false }, { installed: false }, { reason: "wireguard_static_peer_overlap" }, { error: "Install failed" },
  ])("excludes routes that are not successfully installed additions: %j", fields => {
    const { candidate, routes, key } = learnedFixture();
    Object.assign(routes.routes[0]!, fields);
    expect(learnedAllowedNetworks(candidate, routes, "wg0", key)).toEqual([]);
  });
  it("omits exact and subnet coverage from static AllowedIPs but retains broader learned prefixes", () => {
    const { candidate, routes, key } = learnedFixture();
    routes.routes = ["10.0.0.0/8", "10.20.0.0/24", "2001:db8:20::/64", "0.0.0.0/0"]
      .map(prefix => ({ ...routes.routes[0]!, prefix }));
    expect(learnedAllowedNetworks(candidate, routes, "wg0", key)).toEqual([{ prefix: "0.0.0.0/0", neighbor: "remote" }]);
  });
  it("does not claim additions when BGP is stopped, errored, disabled or unavailable", () => {
    const { candidate, routes, key } = learnedFixture();
    expect(learnedAllowedNetworks(candidate, null, "wg0", key)).toEqual([]);
    expect(learnedAllowedNetworks(undefined, routes, "wg0", key)).toEqual([]);
    expect(learnedAllowedNetworks(candidate, { ...routes, state: "stopped" }, "wg0", key)).toEqual([]);
    expect(learnedAllowedNetworks(candidate, { ...routes, error: "Unavailable" }, "wg0", key)).toEqual([]);
    candidate.bgp!.enabled = false;
    expect(learnedAllowedNetworks(candidate, routes, "wg0", key)).toEqual([]);
  });
  it("does not attach additions to a disabled applied peer or tunnel", () => {
    const { candidate, routes, key } = learnedFixture();
    const tunnel = candidate.interfaces.find(link => link.kind === "wireguard")!;
    if (tunnel.kind !== "wireguard") throw new Error("Missing test tunnel");
    tunnel.wireguard.peers[0]!.enabled = false;
    expect(learnedAllowedNetworks(candidate, routes, "wg0", key)).toEqual([]);
    tunnel.wireguard.peers[0]!.enabled = true;
    tunnel.up = false;
    expect(learnedAllowedNetworks(candidate, routes, "wg0", key)).toEqual([]);
  });
});

describe("WireGuard handshake display", () => {
  const sampledAt = Date.parse("2026-10-28T04:00:00.987Z");
  it.each([
    [125, "green"], [126, "yellow"], [250, "yellow"], [251, "orange"], [375, "orange"], [376, "red"],
  ])("colors a %i-second handshake using the keepalive thresholds", (age, color) => {
    expect(handshakeChip(Math.floor(sampledAt / 1000) - age, 25, sampledAt).color).toBe(color);
  });
  it.each([null, undefined, 0])("marks %s as never handshaken", seconds => {
    expect(handshakeChip(seconds, 25, sampledAt)).toMatchObject({ label: "NEVER", color: "red" });
  });
  it("keeps keepalive-off neutral and formats the tooltip in UTC without fractional seconds", () => {
    expect(handshakeChip(Math.floor(sampledAt / 1000) - 30, 0, sampledAt)).toEqual({
      label: "30 seconds ago", color: "default",
      title: "Last handshake 2026-10-28 03:59:30 UTC. Keepalive is off, so there is no expected interval.",
    });
  });
  it("uses the system timezone in tooltips without changing handshake age or thresholds", () => {
    const seconds = Math.floor(sampledAt / 1000) - 30;
    expect(handshakeChip(seconds, 25, sampledAt, "America/Los_Angeles")).toMatchObject({
      label: "30 seconds ago", color: "green",
      title: expect.stringContaining("Last handshake 2026-10-27 20:59:30 America/Los_Angeles;"),
    });
  });
});
