import type { RouteTable, RouteTableRow } from "@/services/routeTable";

export function kernelRoute(overrides: Partial<RouteTableRow> = {}): RouteTableRow {
  return {
    family: "ipv4", destination: "0.0.0.0/0", source_prefix: "0.0.0.0/0",
    table: 254, header_table: 254, protocol: 4, scope: 0, type: 1, tos: 0, flags: 0,
    gateway: "192.0.2.1", preferred_source: null,
    interface_index: 2, interface: "wan0", input_interface_index: null, input_interface: null,
    metric: null, mark: null, uid: null, nexthop_id: null, preference: null, expires: null,
    metrics: [], cache_info: null, next_hops: [], attributes: [],
    ...overrides,
  };
}
export function kernelTable(routes = [kernelRoute()]): RouteTable {
  return {
    source: "kernel", scope: "linux:synthetic", byte_order: "little",
    collected_at_unix_ms: Date.parse("2026-11-14T00:25:10.987Z"), routes,
  };
}
