import { describe, expect, it } from "vitest";
import { bgpSchema, bgpStatusSchema, bgpRoutesSchema, bgpAdvertisedRoutesSchema, configSchema, destinationRewriteSchema, stateSchema, transactionSchema, runtimeSchema, interfaceSchema } from "@/types/domain";
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
  it("requires WireGuard bootstrap AllowedIPs, an enabled referenced peer, and one neighbor per peer", () => {
    const candidate = bgpConfig(), publicKey = "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=";
    const wg = interfaceSchema.parse({
      ...candidate.interfaces[0], kind: "wireguard",
      wireguard: { key_ref: "a".repeat(32), listen_port: 51820, peers: [{ public_key: publicKey, enabled: true, allowed_ips: ["192.0.2.0/24"], persistent_keepalive_seconds: 25 }] },
    });
    candidate.interfaces[0] = wg; candidate.bgp!.neighbors[0]!.wireguard_public_key = publicKey;
    expect(validateConfig(candidate)).toEqual([]);
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
