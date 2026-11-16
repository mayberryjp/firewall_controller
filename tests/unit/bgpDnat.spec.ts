import { describe, expect, it } from "vitest";
import { bgpSchema, bgpNeighborSchema, bgpStatusSchema, bgpRoutesSchema, bgpAdvertisedRoutesSchema, configSchema, destinationRewriteSchema, stateSchema, transactionSchema, runtimeSchema, interfaceSchema } from "@/types/domain";
import { differenceContext, differences, equalConfig, importConfig, normalize, requiredPermissions, serviceRepairPermissions, validateConfig } from "@/services/configuration";
import { bgpPeerStatus } from "@/services/bgp";
import { processRestartTarget } from "@/services/operations";
import { overviewLayoutSchema } from "@/services/overviewLayout";
import { bgpConfig, bgpStatus, bgpRoutes, dnatRule } from "../bgpFixtures";
import { config, state, runtime, transaction, processHealthSnapshot } from "../fixtures";

describe("BGP and DNAT configuration contracts", () => {
  it("parses advertised routes separately without inventing received path attributes", () => {
    const row = { prefix: "203.0.113.0/24", neighbor: "remote", interface: "wg0", next_hop: "10.10.0.1", source: "bgp" };
    const response = { source: "bgp", scope: "linux:opaque", state: "running", error: null, routes: [row, { ...row, neighbor: "second" }] };
    expect(bgpAdvertisedRoutesSchema.parse(response).routes).toEqual(response.routes);
    expect(bgpRoutesSchema.safeParse(response).success).toBe(false);
    expect(bgpAdvertisedRoutesSchema.parse({ ...response, state: "simulated", routes: [] }).routes).toEqual([]);
    expect(bgpAdvertisedRoutesSchema.safeParse({ ...response, routes: null }).success).toBe(false);
  });
  it("preserves BGP, DNAT, metadata and unrelated settings across state, import, normalization, and transaction parsing", () => {
    const candidate = bgpConfig();
    Object.assign(candidate.bgp!.neighbors[0]!, { enabled: false, address: "198.51.100.22", multihop_ttl: 8, allowed_next_hops: ["192.0.2.1"] });
    candidate.bgp!.metadata = { display_name: "Router", description: "BGP identity" };
    candidate.bgp!.neighbors[0]!.metadata = { display_name: "Transit", description: "Trusted link" };
    candidate.firewall.nat.destination_rewrite = [{ ...dnatRule(), metadata: { display_name: "DNS", description: "Routed replies" } }];
    expect(validateConfig(candidate)).toEqual([]);
    expect(importConfig(JSON.stringify(candidate))).toEqual(candidate);
    expect(stateSchema.parse({ ...state(), desired: candidate, observed: candidate }).desired).toEqual(candidate);
    expect(transactionSchema.parse({ ...transaction(), candidate }).candidate).toEqual(candidate);
    expect(normalize(candidate).firewall.nat.destination_rewrite).toEqual(candidate.firewall.nat.destination_rewrite);
    expect(normalize(candidate).bgp).toEqual(candidate.bgp);
    expect(candidate.firewall.nat.masquerade).toEqual(config().firewall.nat.masquerade);
  });
  it("retains old-backend omission compatibility but rejects null DNAT collections and wrong field types", () => {
    expect(configSchema.parse(config()).firewall.nat.destination_rewrite ?? []).toEqual([]);
    const candidate = bgpConfig();
    expect(configSchema.safeParse({ ...candidate, firewall: { ...candidate.firewall, nat: { ...candidate.firewall.nat, destination_rewrite: null } } }).success).toBe(false);
    expect(destinationRewriteSchema.safeParse({ ...dnatRule(), destination_port: "53" }).success).toBe(false);
    expect(destinationRewriteSchema.safeParse({ ...dnatRule(), target_port: 53 }).success).toBe(false);
    expect(equalConfig(config(), { ...config(), bgp: bgpSchema.parse({}) })).toBe(true);
    const empty = config(); empty.firewall.nat.destination_rewrite = [];
    expect(equalConfig(config(), empty)).toBe(true);
  });
  it("reviews and authorizes DNAT ordering, removal and metadata and BGP edits separately", () => {
    const before = bgpConfig(), after = bgpConfig();
    after.firewall.nat.destination_rewrite = [dnatRule(), { ...dnatRule(), protocol: "tcp" }];
    after.bgp!.neighbors[0]!.accept_default = true;
    const changes = differences(before, after);
    expect(requiredPermissions(changes)).toEqual(["transactions.write", "bgp.write", "nat.write"]);
    for (const change of changes) {
      const context = differenceContext(normalize(before), normalize(after), change);
      if (change.area === "bgp") expect(context.after.bgp).toEqual(after.bgp);
      else expect(context.after.firewall.nat.destination_rewrite).toHaveLength(1);
    }
    const reversed = structuredClone(after);
    reversed.firewall.nat.destination_rewrite!.reverse();
    expect(differences(after, reversed).every(change => change.area === "dnat" && change.kind === "moved")).toBe(true);
    const labelled = structuredClone(after);
    labelled.firewall.nat.destination_rewrite![0]!.metadata = { display_name: "DNS", description: "" };
    expect(requiredPermissions(differences(after, labelled))).toEqual(["transactions.write", "nat.write"]);
    expect(serviceRepairPermissions(after, "ntp")).toContain("bgp.write");
  });
  it.each([0, 23456, 65535, 4294967295, 1.5])("rejects local/remote ASN %s", asn => {
    const candidate = bgpConfig(); candidate.bgp!.local_asn = asn; candidate.bgp!.neighbors[0]!.remote_asn = asn;
    const issues = validateConfig(candidate);
    expect(issues.some(issue => issue.path === "bgp.local_asn")).toBe(true);
    expect(issues.some(issue => issue.path.endsWith("remote_asn"))).toBe(true);
  });
  it("requires explicit TTL and gateways for routed speakers, preserving BGP review permissions", () => {
    const before = bgpConfig(), candidate = bgpConfig(), peer = candidate.bgp!.neighbors[0]!;
    peer.address = "198.51.100.22";
    expect(validateConfig(candidate).some(issue => issue.message.includes("TTL greater than 1"))).toBe(true);
    peer.multihop_ttl = 8;
    expect(validateConfig(candidate).some(issue => issue.message.includes("explicit on-link"))).toBe(true);
    peer.allowed_next_hops = ["192.0.2.1"];
    expect(validateConfig(candidate)).toEqual([]);
    expect(requiredPermissions(differences(before, candidate))).toEqual(["transactions.write", "bgp.write"]);
    peer.multihop_ttl = 255;
    peer.allowed_next_hops = Array.from({ length: 32 }, (_, index) => `192.0.2.${index + 20}`);
    expect(validateConfig(candidate)).toEqual([]);
    peer.allowed_next_hops.push("192.0.2.100");
    expect(validateConfig(candidate).some(issue => issue.path.endsWith("allowed_next_hops"))).toBe(true);
  });
  it.each([
    ["192.0.2.10"], ["203.0.113.1"], ["192.0.2.0"], ["192.0.2.255"],
    ["198.51.100.1"], ["127.0.0.1"], ["224.0.0.1"], ["0.0.0.0"], ["::1"], ["192.0.2.1", "192.0.2.1"],
  ])("rejects invalid authorized gateways %j", (...gateways) => {
    const candidate = bgpConfig();
    candidate.bgp!.neighbors[0]!.allowed_next_hops = gateways;
    expect(validateConfig(candidate).some(issue => issue.path.startsWith("bgp.neighbors"))).toBe(true);
  });
  it("accepts /31 gateway hosts but not off-link gateways on a /32", () => {
    const candidate = bgpConfig(), peer = candidate.bgp!.neighbors[0]!;
    candidate.interfaces[0]!.addresses = ["192.0.2.0/31"];
    Object.assign(peer, { address: "198.51.100.22", local_address: "192.0.2.0", multihop_ttl: 8, allowed_next_hops: ["192.0.2.1"] });
    expect(validateConfig(candidate)).toEqual([]);
    candidate.interfaces[0]!.addresses = ["192.0.2.0/32"];
    expect(validateConfig(candidate).some(issue => issue.message.includes("on-link"))).toBe(true);
  });
  it("defaults omitted neighbor fields but rejects nulls, invalid TTL and malformed gateway collections", () => {
    const peer = { name: "remote", address: "192.0.2.2", local_address: "192.0.2.10", interface: "lab0", remote_asn: 65002 };
    expect(bgpNeighborSchema.parse(peer)).toMatchObject({ enabled: true, multihop_ttl: 1, allowed_next_hops: [] });
    for (const enabled of [null, "false", 0]) expect(bgpNeighborSchema.safeParse({ ...peer, enabled }).success).toBe(false);
    for (const ttl of [0, 256, 1.5, "8", null]) expect(bgpNeighborSchema.safeParse({ ...peer, multihop_ttl: ttl }).success).toBe(false);
    for (const gateways of [null, "192.0.2.1", [1]]) expect(bgpNeighborSchema.safeParse({ ...peer, allowed_next_hops: gateways }).success).toBe(false);
  });
  it("retains latest rejection context in status and runtime without changing session state", () => {
    const observed = bgpStatus(), rejection = { prefix: "203.0.113.0/24", next_hop: "192.0.2.3", reason: "next_hop_not_allowed" };
    observed.neighbors![0]!.last_rejection = rejection;
    expect(bgpStatusSchema.parse(observed).neighbors![0]).toMatchObject({ state: "established", last_rejection: rejection });
    expect(runtimeSchema.parse({ ...runtime(), bgp: observed }).bgp?.neighbors![0]!.last_rejection).toEqual(rejection);
    observed.neighbors![0]!.last_rejection = null;
    expect(bgpStatusSchema.parse(observed).neighbors![0]!.last_rejection).toBeNull();
    expect(bgpStatusSchema.safeParse({ ...observed, neighbors: [{ ...observed.neighbors![0], last_rejection: { prefix: rejection.prefix } }] }).success).toBe(false);
  });
  it("validates identity, neighbor uniqueness, peering interface, local address, timers and global limits", () => {
    const candidate = bgpConfig(), bgp = candidate.bgp!;
    bgp.router_id = "::1"; bgp.keepalive_seconds = 31; bgp.hold_seconds = 2; bgp.max_prefixes = 16385;
    bgp.neighbors.push({ ...bgp.neighbors[0]! }); candidate.interfaces[0]!.up = false;
    const issues = validateConfig(candidate).filter(issue => issue.path.startsWith("bgp"));
    for (const field of ["router_id", "keepalive_seconds", "hold_seconds", "max_prefixes", "neighbors.1.name"]) expect(issues.some(issue => issue.path === `bgp.${field}`)).toBe(true);
    bgp.neighbors = []; expect(validateConfig(candidate).some(issue => issue.message.includes("requires at least one"))).toBe(true);
  });
  it.each(["192.0.2.10", "192.0.2.0", "192.0.2.255", "198.51.100.53", "127.0.0.1", "169.254.1.1", "::ffff:192.0.2.53"])("rejects unusable DNAT target %s", target => {
    const candidate = bgpConfig(); candidate.firewall.nat.destination_rewrite = [{ ...dnatRule(), target_address: target }];
    expect(validateConfig(candidate).some(issue => issue.path.startsWith("firewall.nat.destination_rewrite"))).toBe(true);
  });
  it("validates role, up, family, duplicate matches, IPv6 opt-in and collection limits", () => {
    const candidate = bgpConfig(); candidate.firewall.nat.destination_rewrite = [dnatRule(), dnatRule()];
    expect(validateConfig(candidate).some(issue => issue.message.includes("Duplicate WAN"))).toBe(true);
    candidate.firewall.nat.destination_rewrite = [{ ...dnatRule(), target_address: "2001:db8::53" }];
    expect(validateConfig(candidate).some(issue => issue.message.includes("WAN requires"))).toBe(true);
    candidate.interfaces[1]!.addresses.push("2001:db8:1::1/64");
    expect(validateConfig(candidate)).toEqual([]);
    candidate.ipv6_enabled = false;
    expect(validateConfig(candidate).some(issue => issue.path.includes("destination_rewrite"))).toBe(true);
    candidate.ipv6_enabled = true; candidate.interfaces[1]!.role = "lan";
    expect(validateConfig(candidate).some(issue => issue.message.includes("managed WAN"))).toBe(true);
    candidate.firewall.nat.destination_rewrite = Array.from({ length: 257 }, () => dnatRule());
    expect(validateConfig(candidate).some(issue => issue.message.includes("At most 256"))).toBe(true);
  });
  it("keeps unavailable/simulated/down observations distinct from establishment", () => {
    const peer = bgpConfig().bgp!.neighbors[0]!;
    expect(bgpPeerStatus(peer, true, bgpStatus(), true)).toMatchObject({ label: "Established", color: "success" });
    expect(bgpPeerStatus(peer, true, bgpStatus(), false)).toMatchObject({ label: "Unknown", color: "default" });
    expect(bgpPeerStatus(peer, true, { state: "simulated" }, true)).toMatchObject({ label: "Simulated", color: "default" });
    expect(bgpStatusSchema.parse({ state: "starting" })).toEqual({ state: "starting" });
    expect(bgpRoutesSchema.parse(bgpRoutes()).routes[0]).toMatchObject({ selected: true, installed: false });
    expect(overviewLayoutSchema.parse({ version: 1, columns: [["bgp"], []] }).columns[0]).toEqual(["bgp"]);
    const component = processHealthSnapshot().process_health!.components[0]!;
    expect(processRestartTarget({ ...component, component: "appliance_services", resource: "bgp" }, bgpConfig())).toBe("bgp");
  });
  it("keeps administrative peer disable independent of process health and still validates disabled peers", () => {
    const candidate = bgpConfig(), peer = candidate.bgp!.neighbors[0]!;
    peer.enabled = false;
    expect(validateConfig(candidate)).toEqual([]);
    expect(bgpPeerStatus(peer, true, bgpStatus(), true)).toMatchObject({ label: "Disabled", color: "default" });
    expect(bgpPeerStatus(peer, true, null, false)).toMatchObject({ label: "Disabled", color: "default" });
    const observed = bgpStatus();
    Object.assign(observed.neighbors![0]!, { enabled: false, state: "disabled", received_prefixes: null, advertised_prefixes: null, last_rejection: null });
    expect(bgpStatusSchema.parse(observed).neighbors![0]).toMatchObject({ enabled: false, state: "disabled", received_prefixes: null });
    expect(requiredPermissions(differences(bgpConfig(), candidate))).toEqual(["transactions.write", "bgp.write"]);
    candidate.interfaces[0]!.up = false;
    expect(validateConfig(candidate).some(issue => issue.path.startsWith("bgp.neighbors"))).toBe(true);
  });
  it("accepts native BGP runtime service rows without inventing a host/managed scope", () => {
    const native = { ...runtime(), bgp: bgpStatus(), appliance_services: [...runtime().appliance_services, bgpStatus()] };
    const parsed = runtimeSchema.parse(native);
    expect(parsed.bgp).toEqual(bgpStatus());
    expect(parsed.appliance_services.at(-1)).toEqual(bgpStatus());
  });
  it("accepts exact BGP timer, ASN, global-prefix and peer-count bounds, rejecting the next peer", () => {
    const candidate = bgpConfig(), settings = candidate.bgp!;
    settings.local_asn = 4294967294; settings.hold_seconds = 65535; settings.keepalive_seconds = 21845; settings.max_prefixes = 16384;
    settings.neighbors = Array.from({ length: 32 }, (_, index) => ({ ...settings.neighbors[0]!, name: `peer${index}`, address: `192.0.2.${index + 20}` }));
    expect(validateConfig(candidate)).toEqual([]);
    settings.neighbors.push({ ...settings.neighbors[0]!, name: "extra", address: "192.0.2.100" });
    expect(validateConfig(candidate).some(issue => issue.message.includes("At most 32"))).toBe(true);
    settings.neighbors.pop(); settings.hold_seconds = 3; settings.keepalive_seconds = 1; settings.max_prefixes = 1;
    expect(validateConfig(candidate)).toEqual([]);
  });
  it("accepts exactly 256 distinct DNAT rules and rejects rule 257", () => {
    const candidate = bgpConfig();
    candidate.firewall.nat.destination_rewrite = Array.from({ length: 256 }, (_, index) => ({ ...dnatRule(), destination_port: index + 1 }));
    expect(validateConfig(candidate)).toEqual([]);
    candidate.firewall.nat.destination_rewrite.push({ ...dnatRule(), destination_port: 257 });
    expect(validateConfig(candidate).some(issue => issue.message.includes("At most 256"))).toBe(true);
  });
  it("validates WireGuard gateway ownership independently of speaker bootstrap and tunnel subnet", () => {
    const candidate = bgpConfig(), publicKey = "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=";
    const wg = interfaceSchema.parse({
      ...candidate.interfaces[0], kind: "wireguard",
      wireguard: { key_ref: "a".repeat(32), listen_port: 51820, peers: [{
        public_key: publicKey, enabled: true, allowed_ips: ["198.51.100.22/32", "2001:db8::/32"], persistent_keepalive_seconds: 25,
      }] },
    });
    if (wg.kind !== "wireguard") throw new Error("Expected WireGuard fixture");
    candidate.interfaces[0] = wg;
    const peer = candidate.bgp!.neighbors[0]!, forwarding = wg.wireguard.peers[0]!;
    Object.assign(peer, { address: "198.51.100.22", multihop_ttl: 8, wireguard_public_key: publicKey, allowed_next_hops: ["198.51.100.1"] });
    expect(validateConfig(candidate).some(issue => issue.message.includes("198.51.100.1 must be covered"))).toBe(true);
    forwarding.allowed_ips.push("198.51.100.1/32");
    expect(validateConfig(candidate)).toEqual([]);
    wg.wireguard.peers.push({ ...forwarding, public_key: btoa("\x03".repeat(32)), allowed_ips: ["198.51.100.0/24"] });
    expect(validateConfig(candidate).some(issue => issue.message.includes("198.51.100.1 overlaps another enabled"))).toBe(true);
    wg.wireguard.peers[1]!.enabled = false;
    expect(validateConfig(candidate)).toEqual([]);
    forwarding.allowed_ips = ["198.51.100.1/32"];
    expect(validateConfig(candidate).some(issue => issue.message.includes("cover the BGP address"))).toBe(true);
    forwarding.allowed_ips = ["198.51.100.22/32"];
    peer.allowed_next_hops = [];
    expect(validateConfig(candidate)).toEqual([]);
  });
  it("requires WireGuard bootstrap AllowedIPs, an enabled referenced peer, and one neighbor per peer", () => {
    const candidate = bgpConfig(), publicKey = "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=";
    const wg = interfaceSchema.parse({
      ...candidate.interfaces[0], kind: "wireguard",
      wireguard: { key_ref: "a".repeat(32), listen_port: 51820, peers: [{ public_key: publicKey, enabled: true, allowed_ips: ["192.0.2.0/24"], persistent_keepalive_seconds: 25 }] },
    });
    candidate.interfaces[0] = wg; candidate.bgp!.neighbors[0]!.wireguard_public_key = publicKey;
    expect(validateConfig(candidate)).toEqual([]);
    candidate.bgp!.neighbors[0]!.allowed_next_hops = ["192.0.2.1"];
    expect(validateConfig(candidate)).toEqual([]);
    for (const gateways of [["::1"], ["127.0.0.1"], ["224.0.0.1"], ["192.0.2.10"], ["192.0.2.1", "192.0.2.1"]]) {
      candidate.bgp!.neighbors[0]!.allowed_next_hops = gateways;
      expect(validateConfig(candidate).some(issue => issue.path.startsWith("bgp.neighbors"))).toBe(true);
    }
    candidate.bgp!.neighbors[0]!.allowed_next_hops = [];
    if (wg.kind !== "wireguard") throw new Error("Expected WireGuard fixture");
    wg.wireguard.peers[0]!.enabled = false;
    expect(validateConfig(candidate).some(issue => issue.message.includes("enabled WireGuard peer"))).toBe(true);
    wg.wireguard.peers[0]!.enabled = true; wg.wireguard.peers[0]!.allowed_ips = ["198.51.100.0/24"];
    expect(validateConfig(candidate).some(issue => issue.message.includes("static AllowedIPs"))).toBe(true);
    wg.wireguard.peers[0]!.allowed_ips = ["192.0.2.0/24"];
    candidate.bgp!.neighbors.push({ ...candidate.bgp!.neighbors[0]!, name: "second", address: "192.0.2.3" });
    expect(validateConfig(candidate).some(issue => issue.message.includes("one BGP neighbor"))).toBe(true);
  });
});
