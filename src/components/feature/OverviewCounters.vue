<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useControllerStore } from "@/stores/controller";
import { isInitialLoad } from "@/services/datasets";
import { formatBytes } from "@/services/hostHealth";
import { isSystemLoopback } from "@/services/resourceCollections";
import OverviewWidget from "./OverviewWidget.vue";
import OverviewInterfaceIdentity from "./OverviewInterfaceIdentity.vue";
const store = useControllerStore();
const counters = [
  { label: "Packets in", key: "rx_packets" }, { label: "Packets out", key: "tx_packets" },
  { label: "Bytes in", key: "rx_bytes" }, { label: "Bytes out", key: "tx_bytes" },
  { label: "Errors in", key: "rx_errors" }, { label: "Errors out", key: "tx_errors" },
];
const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const packetFormat = new Intl.NumberFormat("en-US", { notation: "compact", minimumFractionDigits: 2, maximumFractionDigits: 2 });
type PacketKey = "rx_packets" | "tx_packets";
function isPacket(key: string): key is PacketKey {
  return key === "rx_packets" || key === "tx_packets";
}
function formatCounter(value: string | undefined, key: string): string {
  if (key === "rx_bytes" || key === "tx_bytes") return formatBytes(value);
  if (value === undefined) return "Unavailable";
  const count = BigInt(value);
  return isPacket(key) && count >= 100000n ? packetFormat.format(count) : numberFormat.format(count);
}
interface PacketBaseline {
  identity: string;
  counters: Partial<Record<PacketKey, string>>;
}
interface PacketChange { text: string; title: string; color: string }
const changes = ref<Record<string, Partial<Record<PacketKey, PacketChange>>>>({});
let previous: { scope: string; time: number; interfaces: Map<string, PacketBaseline> } | null = null;
watch(() => [store.statistics.data, store.statistics.stale, store.statistics.error] as const, ([data, stale, error]) => {
  if (!data || stale || error || !["available", "partial"].includes(data.sample.status)) {
    previous = null; changes.value = {}; return;
  }
  const time = Date.parse(data.sample.collected_at);
  const comparable = previous?.scope === data.sample.scope && time > previous.time;
  const next = new Map<string, PacketBaseline>();
  const deltas: typeof changes.value = {};
  for (const item of data.interfaces) {
    if (item.status !== "available" || item.error || !item.counters) continue;
    const identity = JSON.stringify([item.index, item.mac, item.kind, item.counter_bits]);
    const before = comparable ? previous?.interfaces.get(item.name) : undefined;
    const counters: PacketBaseline["counters"] = {};
    for (const key of ["rx_packets", "tx_packets"] as const) {
      const value = item.counters[key];
      if (value === undefined || BigInt(value) < 0n) continue;
      counters[key] = value;
      const earlier = before?.counters[key];
      if (before?.identity !== identity || earlier === undefined) continue;
      const delta = BigInt(value) - BigInt(earlier);
      if (delta < 0n) continue;
      (deltas[item.name] ??= {})[key] = {
        text: `+${formatCounter(delta.toString(), key)}`,
        title: `+${numberFormat.format(delta)} packets since previous poll`,
        color: delta === 0n ? "default" : "info",
      };
    }
    next.set(item.name, { identity, counters });
  }
  previous = { scope: data.sample.scope, time, interfaces: next };
  changes.value = deltas;
}, { immediate: true });
function packetChange(name: string, key: string): PacketChange | undefined {
  return isPacket(key) ? changes.value[name]?.[key] : undefined;
}
const note = computed(() => store.statistics.error ? "Unavailable" : isInitialLoad(store.statistics) ? "" : store.statistics.stale ? "Stale" : store.statistics.data?.sample.status === "simulated" ? "Simulated" : "");
</script>

<template>
  <OverviewWidget
    title="Interface counters"
    title-to="/diagnostics/traffic"
    :note="note"
    :detail="store.statistics.error ?? undefined"
  >
    <v-table
      density="compact"
      class="overview-counters"
    >
      <colgroup>
        <col style="width: 25%"><col
          v-for="counter in counters"
          :key="counter.key"
          style="width: 12.5%"
        >
      </colgroup>
      <thead>
        <tr>
          <th scope="col">
            Interface
          </th>
          <th
            v-for="counter in counters"
            :key="counter.key"
            scope="col"
            :title="counter.label"
          >
            {{ counter.label }}
          </th>
        </tr>
      </thead>
      <tbody v-if="store.statistics.data?.interfaces.length">
        <tr
          v-for="item in store.statistics.data.interfaces"
          :key="item.name"
        >
          <th scope="row">
            <OverviewInterfaceIdentity
              :name="item.name"
              :loopback="isSystemLoopback(item)"
            >
              <RouterLink
                :to="{ path: '/diagnostics/traffic', query: { interface: item.name } }"
                class="counter-link"
              >
                {{ item.name }}
              </RouterLink>
            </OverviewInterfaceIdentity>
          </th>
          <td
            v-for="counter in counters"
            :key="counter.key"
            class="mono"
            :title="item.counters?.[counter.key]"
          >
            <span class="counter-value">
              <span>{{ formatCounter(item.counters?.[counter.key], counter.key) }}</span>
              <v-chip
                v-if="packetChange(item.name, counter.key)"
                size="x-small"
                variant="tonal"
                :color="packetChange(item.name, counter.key)?.color"
                :title="packetChange(item.name, counter.key)?.title"
                :aria-label="packetChange(item.name, counter.key)?.title"
              >
                {{ packetChange(item.name, counter.key)?.text }}
              </v-chip>
            </span>
          </td>
        </tr>
      </tbody>
      <tbody v-else-if="!isInitialLoad(store.statistics)">
        <tr>
          <td :colspan="counters.length + 1">
            No interface counters available.
          </td>
        </tr>
      </tbody>
    </v-table>
  </OverviewWidget>
</template>

<style scoped>
.overview-counters { container-type: inline-size; }
.overview-counters :deep(table) { width: 100%; table-layout: fixed; }
.overview-counters :deep(table th), .overview-counters :deep(table td) { padding: 2px 6px !important; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.overview-counters :deep(table th) { font-size: 12px; }
.counter-value { display: flex; flex-direction: column; align-items: flex-start; max-width: 100%; line-height: 14px; }
.counter-value > span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.counter-value :deep(.v-chip) { min-width: 0; max-width: 100%; height: 14px; font-size: 10px; }
.counter-value :deep(.v-chip__content) { display: block; overflow: hidden; text-overflow: ellipsis; }
.counter-link { color: inherit; text-decoration: none; }
@container (max-width: 480px) {
  .overview-counters :deep(table),
  .overview-counters :deep(thead),
  .overview-counters :deep(tbody) { display: block; }
  .overview-counters :deep(colgroup) { display: none; }
  .overview-counters :deep(tr) { display: grid; grid-template-columns: 30% repeat(3, minmax(0, 1fr)); grid-template-rows: repeat(2, minmax(17px, auto)); }
  .overview-counters :deep(table th),
  .overview-counters :deep(table td) { min-width: 0; height: auto !important; padding: 0 6px !important; line-height: 14px; align-content: center; }
  .overview-counters :deep(tr > :first-child) { grid-column: 1; grid-row: 1 / span 2; }
  .overview-counters :deep(tr > :nth-child(2)) { grid-column: 2; grid-row: 1; }
  .overview-counters :deep(tr > :nth-child(3)) { grid-column: 2; grid-row: 2; }
  .overview-counters :deep(tr > :nth-child(4)) { grid-column: 3; grid-row: 1; }
  .overview-counters :deep(tr > :nth-child(5)) { grid-column: 3; grid-row: 2; }
  .overview-counters :deep(tr > :nth-child(6)) { grid-column: 4; grid-row: 1; }
  .overview-counters :deep(tr > :nth-child(7)) { grid-column: 4; grid-row: 2; }
  .overview-counters :deep(td[colspan]) { grid-column: 1 / -1; }
}
</style>