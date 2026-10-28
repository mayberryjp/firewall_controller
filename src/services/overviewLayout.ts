import { z } from "zod";

export const overviewWidgetIds = ["interfaces", "gateways", "wireguard", "bgp", "system", "counters"] as const;
const widgetSchema = z.enum(overviewWidgetIds);
export const overviewLayoutSchema = z.object({
  version: z.literal(1),
  columns: z.tuple([z.array(widgetSchema).max(6), z.array(widgetSchema).max(6)]),
}).strict().refine(layout => {
  const ids = layout.columns.flat();
  return new Set(ids).size === ids.length;
}, "Overview boxes must not appear more than once");

export type OverviewWidgetId = typeof overviewWidgetIds[number];
export type OverviewLayout = z.infer<typeof overviewLayoutSchema>;

export function defaultOverviewLayout(): OverviewLayout {
  return { version: 1, columns: [["interfaces", "gateways", "wireguard", "bgp"], ["system", "counters"]] };
}

export function copyOverviewLayout(layout: OverviewLayout): OverviewLayout {
  return { version: 1, columns: [[...layout.columns[0]], [...layout.columns[1]]] };
}
