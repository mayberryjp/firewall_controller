import { describe, expect, it } from "vitest";
import { cloneConfig, differences, importConfig, isWireGuardRoute, requiredPermissions, syncWireGuardRoutes, validateConfig } from "@/services/configuration";
import { encodeJson } from "@/services/json";
import type { Config, ManagedInterface } from "@/types/domain";
import { config } from "../fixtures";

function tunnel(name = "wg0"): Extract<ManagedInterface, { kind: "wireguard" }> {
  return {
    name, kind: "wireguard", role: "wan", mtu: 1420, up: true, addresses: [],
    dhcp_relay: { enabled: false, servers: [] },
    wireguard: { key_ref: "key", listen_port: 51820, peers: [
      { public_key: btoa("\x01".repeat(32)), allowed_ips: ["10.20.0.0/24", "2001:db8:20::/64"], persistent_keepalive_seconds: 0 },
    ] },
  };
}
const generated = (candidate: Config) => candidate.routes.filter(isWireGuardRoute);

describe("WireGuard Allowed IP routes", () => {
  it("creates canonical IPv4 and IPv6 direct main-table routes, preserves manual routes and is idempotent", () => {
    const before = config(), candidate = config();
    candidate.interfaces.push(tunnel());
    syncWireGuardRoutes(candidate);
    expect(candidate.routes[0]).toEqual(before.routes[0]);
    expect(generated(candidate)).toEqual(["10.20.0.0/24", "2001:db8:20::/64"].map(destination => ({
      destination, interface: "wg0", table: 254, metric: 1, enabled: true,
      metadata: { display_name: "", description: "Automatically managed from WireGuard Allowed IPs." },
    })));
    expect(validateConfig(candidate)).toEqual([]);
    expect(requiredPermissions(differences(before, candidate))).toContain("routes.write");
    const snapshot = cloneConfig(candidate);
    syncWireGuardRoutes(candidate);
    expect(candidate).toEqual(snapshot);
    expect(importConfig(encodeJson(candidate))).toEqual(candidate);
  });

  it("synchronizes disabled peers and shares one route while any peer on the tunnel is enabled", () => {
    const candidate = config(), link = tunnel();
    candidate.interfaces.push(link);
    link.wireguard.peers.push({ ...link.wireguard.peers[0]!, public_key: btoa("\x02".repeat(32)), enabled: false });
    syncWireGuardRoutes(candidate);
    expect(generated(candidate)).toHaveLength(2);
    expect(generated(candidate).every(route => route.enabled)).toBe(true);
    link.wireguard.peers[0]!.enabled = false;
    syncWireGuardRoutes(candidate);
    expect(generated(candidate).every(route => !route.enabled)).toBe(true);
    link.wireguard.peers[1]!.enabled = true;
    syncWireGuardRoutes(candidate);
    expect(generated(candidate).every(route => route.enabled)).toBe(true);
  });

  it("removes obsolete generated routes after Allowed IP edits, peer deletion and tunnel deletion across exports", () => {
    const candidate = config(), link = tunnel();
    candidate.interfaces.push(link);
    syncWireGuardRoutes(candidate);
    link.wireguard.peers[0]!.allowed_ips = ["10.30.0.0/24"];
    syncWireGuardRoutes(candidate);
    expect(generated(candidate).map(route => route.destination)).toEqual(["10.30.0.0/24"]);
    const restored = importConfig(encodeJson(candidate));
    const restoredLink = restored.interfaces.find(item => item.kind === "wireguard")!;
    if (restoredLink.kind !== "wireguard") throw new Error("Missing tunnel");
    restoredLink.wireguard.peers = [];
    syncWireGuardRoutes(restored);
    expect(restored.routes).toEqual(config().routes);
    candidate.interfaces = candidate.interfaces.filter(item => item.name !== "wg0");
    syncWireGuardRoutes(candidate);
    expect(candidate.routes).toEqual(config().routes);
  });

  it("reuses compatible manual routes without changing their metadata or metric", () => {
    const candidate = config();
    candidate.interfaces.push(tunnel());
    const manual = {
      enabled: true, destination: "10.20.0.0/24", interface: "wg0", table: 254, metric: 50,
      metadata: { display_name: "Manual VPN", description: "Keep this route" },
    };
    candidate.routes.push(manual);
    syncWireGuardRoutes(candidate);
    expect(candidate.routes.filter(route => route.destination === manual.destination)).toEqual([manual]);
    expect(generated(candidate)).toHaveLength(1);
  });

  it.each([
    { interface: "lab0" }, { interface: "wg0", gateway: "10.20.0.1" }, { interface: "wg0", enabled: false },
  ])("rejects conflicting manual routes without modifying them: %j", fields => {
    const candidate = config();
    candidate.interfaces.push(tunnel());
    candidate.routes.push({ enabled: true, destination: "10.20.0.0/24", table: 254, metric: 1, ...fields });
    const snapshot = cloneConfig(candidate);
    expect(() => syncWireGuardRoutes(candidate)).toThrow("conflicts with a manual route");
    expect(candidate).toEqual(snapshot);
  });

  it("rejects ambiguous networks on different tunnels and noncanonical networks", () => {
    const candidate = config();
    candidate.interfaces.push(tunnel(), tunnel("wg1"));
    expect(() => syncWireGuardRoutes(candidate)).toThrow("single tunnel per network");
    candidate.interfaces.pop();
    const link = candidate.interfaces[1]!;
    if (link.kind !== "wireguard") throw new Error("Missing tunnel");
    link.wireguard.peers[0]!.allowed_ips = ["10.20.0.1/24"];
    expect(() => syncWireGuardRoutes(candidate)).toThrow("Host bits must be cleared");
  });
});
