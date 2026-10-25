import { computed, reactive } from "vue";
import { useControllerStore } from "@/stores/controller";
import { record } from "@/types/forms";
import { prefix, stableJson } from "@/services/configuration";
import { resourceItems } from "@/services/resourceCollections";
import type { Section } from "@/services/resourceForms";
import type { DiscoveredInterface } from "@/types/domain";

export interface ResourceRow { value: Record<string, unknown>; index: number; rowID: string; discovered?: DiscoveredInterface }
export interface ResourceFilters {
  search: string;
  kind: string;
  role: string;
  admin: string;
  interface: string;
  family: string;
  table: string;
  enabled: string;
}

export function useResourceCollection(section: Section, wireguard: boolean, name?: string, vlan = false) {
  const store = useControllerStore();
  const filters = reactive<ResourceFilters>({ search: "", kind: "All", role: "All", admin: "All", interface: "All", family: "All", table: "", enabled: "All" });
  const selectedConfig = computed(() => store.draft ?? store.state.data?.active_transaction?.candidate ?? store.state.data?.desired);
  const rows = computed<ResourceRow[]>(() => selectedConfig.value ? resourceItems(selectedConfig.value, section).map((value, index) => ({
    value: record(value), index,
    rowID: `${stableJson(value)}/${resourceItems(selectedConfig.value!, section).slice(0, index).filter(item => stableJson(item) === stableJson(value)).length}`,
  })).filter(({ value }) => {
    if (name && value.name !== name) return false;
    if (wireguard && value.kind !== "wireguard") return false;
    if (vlan && value.kind !== "vlan") return false;
    if (filters.kind !== "All" && value.kind !== filters.kind) return false;
    if (filters.role !== "All" && value.role !== filters.role.toLowerCase()) return false;
    if (filters.admin !== "All" && value.up !== (filters.admin === "Up")) return false;
    if (filters.interface !== "All" && value.interface !== filters.interface) return false;
    if (filters.enabled !== "All" && (value.enabled !== false) !== (filters.enabled === "Enabled")) return false;
    if (filters.table && String(value.table) !== filters.table) return false;
    if (filters.family !== "All") {
      try { if (prefix(String(value.destination || value.source), true).family !== filters.family) return false; } catch { return false; }
    }
    return JSON.stringify(value).toLowerCase().includes(String(filters.search ?? "").toLowerCase());
  }) : []);
  return { filters, selectedConfig, rows };
}