import { bgpSchema, type BGPStatus, type BGPRoutes, type BGPAdvertisedRoutes, type DestinationRewrite } from "../src/types/domain";
import { config } from "./fixtures";
export function bgpConfig() {
  const candidate = config();
  candidate.interfaces.push({ ...candidate.interfaces[0]!, name: "wan0", role: "wan", addresses: ["203.0.113.1/24"] });
  candidate.firewall.nat.destination_rewrite = [];
  candidate.bgp = bgpSchema.parse({
    enabled: true, local_asn: 65001, router_id: "192.0.2.10",
    neighbors: [{ name: "remote", interface: "lab0", local_address: "192.0.2.10", address: "192.0.2.2", remote_asn: 65002 }],
  });
  return candidate;
}
export function bgpStatus(): BGPStatus {
  return {
    name: "bgp", state: "running", health: "up", error: null, local_asn: 65001, router_id: "192.0.2.10",
    neighbors: [{ name: "remote", address: "192.0.2.2", interface: "lab0", state: "established", received_prefixes: 1, advertised_prefixes: 2, rejected_prefixes: 0, error: null }],
  };
}
export function bgpRoutes(): BGPRoutes {
  return { source: "bgp", scope: "linux:test", state: "running", error: null, routes: [{
    prefix: "198.51.100.0/24", neighbor: "remote", interface: "lab0", next_hop: "192.0.2.2",
    as_path: [65002], origin: 0, local_pref: 100, med: 0, selected: true, installed: false, reason: "connected_or_static_route", source: "bgp",
  }] };
}
export function bgpAdvertisedRoutes(): BGPAdvertisedRoutes {
  return { source: "bgp", scope: "linux:test", state: "running", error: null, routes: [
    { prefix: "203.0.113.0/24", neighbor: "remote", interface: "lab0", next_hop: "192.0.2.10", source: "bgp" },
    { prefix: "203.0.113.0/24", neighbor: "second", interface: "lab0", next_hop: "192.0.2.10", source: "bgp" },
  ] };
}
export function dnatRule(): DestinationRewrite {
  return { out_interface: "wan0", protocol: "udp", destination_port: 53, target_interface: "lab0", target_address: "192.0.2.53" };
}
