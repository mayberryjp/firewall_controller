import { z } from "zod";
import { request } from "@/services/api";

const uint32 = z.number().int().min(0).max(0xffffffff);
const uint8 = z.number().int().min(0).max(255);
const attribute = z.object({
  kind: z.number().int().min(0).max(65535),
  value_hex: z.string().regex(/^(?:[0-9a-f]{2})*$/),
  nested: z.boolean(),
  network_byte_order: z.boolean(),
});
const address = z.string().ip();
const prefix = z.string().cidr();
export const routeTableRowSchema = z.object({
  family: z.enum(["ipv4", "ipv6"]),
  destination: prefix, source_prefix: prefix,
  table: uint32, header_table: uint8,
  protocol: uint8, scope: uint8, type: uint8, tos: uint8, flags: uint32,
  gateway: address.nullable(), preferred_source: address.nullable(),
  interface_index: uint32.nullable(), interface: z.string().nullable(),
  input_interface_index: uint32.nullable(), input_interface: z.string().nullable(),
  metric: uint32.nullable(), mark: uint32.nullable(), uid: uint32.nullable(), nexthop_id: uint32.nullable(),
  preference: uint8.nullable(), expires: z.string().regex(/^(0|[1-9]\d*)$/).nullable(),
  metrics: z.array(attribute),
  cache_info: z.object({
    clntref: uint32, last_use: uint32, expires: uint32, error: uint32,
    used: uint32, id: uint32, ts: uint32, ts_age: uint32,
  }).nullable(),
  next_hops: z.array(z.object({
    interface_index: uint32, interface: z.string().nullable(), gateway: address.nullable(),
    weight: z.number().int().min(1).max(256), flags: uint8, attributes: z.array(attribute),
  })),
  attributes: z.array(attribute),
});
export const routeTableSchema = z.object({
  source: z.literal("kernel"), scope: z.string(),
  collected_at_unix_ms: z.number().int().nonnegative().max(8_640_000_000_000_000),
  byte_order: z.enum(["little", "big"]),
  routes: z.array(routeTableRowSchema).max(65536),
});
export type RouteTableRow = z.infer<typeof routeTableRowSchema>;
export type RouteTable = z.infer<typeof routeTableSchema>;

export function getRouteTable(signal?: AbortSignal): Promise<RouteTable> {
  return request("GET", "/routes/table", routeTableSchema, undefined, signal);
}
