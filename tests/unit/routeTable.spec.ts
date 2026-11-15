import { afterEach, describe, expect, it, vi } from "vitest";
import { request } from "@/services/api";
import { getRouteTable, routeTableSchema } from "@/services/routeTable";
import { kernelRoute, kernelTable } from "../routeTableFixtures";

vi.mock("@/services/api", async original => ({
  ...await original<typeof import("@/services/api")>(), request: vi.fn(),
}));
afterEach(() => vi.resetAllMocks());

describe("Live kernel route contract", () => {
  it("reads the complete table without query parameters or a request body", async () => {
    const data = kernelTable(), signal = new AbortController().signal;
    vi.mocked(request).mockResolvedValueOnce(data);
    expect(await getRouteTable(signal)).toEqual(data);
    expect(request).toHaveBeenCalledExactlyOnceWith("GET", "/routes/table", routeTableSchema, undefined, signal);
  });
  it("preserves null versus zero, unknown identifiers, cross-family gateways and ordered raw attributes", () => {
    const attribute = { kind: 999, value_hex: "0000ff", nested: true, network_byte_order: false };
    const row = kernelRoute({
      family: "ipv6", destination: "::/0", source_prefix: "::/0",
      table: 4000000000, protocol: 242, type: 245, scope: 199, flags: 0x80000000,
      interface: null, interface_index: 99, metric: 0,
      expires: "18446744073709551615", nexthop_id: 123,
      attributes: [attribute, { ...attribute, value_hex: "01", network_byte_order: true }],
      next_hops: [{ interface_index: 100, interface: null, gateway: "2001:db8::1", weight: 256, flags: 128, attributes: [attribute] }],
    });
    const data = kernelTable([kernelRoute(), row]);
    expect(routeTableSchema.parse(data)).toEqual(data);
  });
  it.each([0, 257])("rejects invalid multipath weight %s rather than silently normalizing it", weight => {
    const data = kernelTable([kernelRoute({
      next_hops: [{ interface_index: 2, interface: "wan0", gateway: null, weight, flags: 0, attributes: [] }],
    })]);
    expect(routeTableSchema.safeParse(data).success).toBe(false);
  });
});
