import { z } from "zod";
import { uint64Schema } from "@/services/counters";

const u32 = z.number().int().min(0).max(4294967295);
const text = z.string().nullable();
const linkModeSchema = z.object({
  bit: u32, name: text, speed_mbps: u32.nullable(), duplex: text,
});
export const performanceCapabilitySchema = z.object({
  name: z.string(),
  support: z.enum(["supported", "unsupported", "unknown", "not_applicable"]),
  enabled: z.boolean().nullable(),
  inherited_from: z.string().nullable().optional(),
  evidence: z.array(z.string()),
  reason: text,
});
export const interfaceCapabilitiesSchema = z.object({
  name: z.string(), index: u32.nullable(), mac: text, kind: z.string(),
  driver: z.object({
    name: z.string(), version: text, firmware_version: text, expansion_rom_version: text, bus_address: text,
  }).nullable(),
  hardware: z.object({
    bus: text, address: text, vendor_id: text, device_id: text,
    subsystem_vendor_id: text, subsystem_device_id: text, revision: text,
    numa_node: z.number().int().min(-2147483648).max(2147483647).nullable(),
  }).nullable(),
  link: z.object({
    carrier: z.boolean().nullable(), speed_mbps: u32.nullable(), duplex: text,
    autonegotiation: z.boolean().nullable(),
    supported_modes: z.array(linkModeSchema),
    advertised_modes: z.array(linkModeSchema),
    partner_advertised_modes: z.array(linkModeSchema),
  }).nullable(),
  channels: z.object({
    max_rx: u32, max_tx: u32, max_other: u32, max_combined: u32,
    rx: u32, tx: u32, other: u32, combined: u32,
  }).nullable(),
  rss: z.object({
    context: u32, indirection_table: z.array(u32.max(4095)).max(65536).nullable(),
    hash_function: u32.max(255).nullable(), input_transformation: u32.max(255).nullable(),
  }).nullable().optional(),
  interrupts: z.array(z.object({
    irq: u32, description: text, effective_cpus: z.array(u32).nullable(),
    counts: z.array(z.object({ cpu_id: u32, interrupts: uint64Schema })).nullable(),
    errors: z.array(z.string()),
  })).nullable().optional(),
  queues: z.array(z.object({
    name: z.string(), rps_cpus: text, rps_flow_count: u32.nullable(), xps_cpus: text, xps_rxqs: text,
    irqs: z.array(u32).nullable().optional(), irq_mapping_reason: text.optional(),
  })),
  capabilities: z.array(performanceCapabilitySchema),
  errors: z.array(z.string()),
});
export const interfaceCapabilitySnapshotSchema = z.object({
  collected_at: z.string(), scope: z.string(),
  inventory: z.object({
    source: z.enum(["native", "simulator"]),
    status: z.enum(["observed", "partial", "simulated"]),
    kernel_release: text, boot_id: text, errors: z.array(z.string()),
    interfaces: z.array(interfaceCapabilitiesSchema),
  }),
});
export type InterfaceCapabilitySnapshot = z.infer<typeof interfaceCapabilitySnapshotSchema>;
export type InterfaceCapabilities = z.infer<typeof interfaceCapabilitiesSchema>;
export type PerformanceCapability = z.infer<typeof performanceCapabilitySchema>;

export function rssState(row: InterfaceCapabilities): "Not supported" | "Unknown" | "Enabled" | "Disabled" {
  const feature = row.capabilities.find(item => item.name === "rss");
  if (feature?.support === "unsupported" || feature?.support === "not_applicable") return "Not supported";
  return feature?.enabled == null ? "Unknown" : feature.enabled ? "Enabled" : "Disabled";
}

export function hideRssIrqNavigation(snapshot: InterfaceCapabilitySnapshot | null): boolean {
  const inventory = snapshot?.inventory;
  return inventory !== undefined && inventory.interfaces.length > 0 &&
    inventory.interfaces.every(row => {
      const state = rssState(row);
      return state === "Not supported" || state === "Unknown";
    });
}
