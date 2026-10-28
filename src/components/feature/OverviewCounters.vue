<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useControllerStore } from "@/stores/controller";
import { formatBytes } from "@/services/hostHealth";
import OverviewWidget from "./OverviewWidget.vue";
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
const note = computed(() => store.statistics.error ? "Unavailable" : store.statistics.loading && !store.statistics.data ? "Loading" : store.statistics.stale ? "Stale" : store.statistics.data?.sample.status === "simulated" ? "Simulated" : "");
</script>

<template>
  <OverviewWidget
    title="Interface counters"
    title-to="/diagnostics/traffic"
    :note="note"
    :detail="store.statistics.error ?? undefined"
  >
    <v-table density="compact">
      <thead>
        <tr>
          <th scope="col">
            Interface
          </th>
          <th
            v-for="counter in counters"
            :key="counter.key"
            scope="col"
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
            <RouterLink
              :to="{ path: '/diagnostics/traffic', query: { interface: item.name } }"
              class="counter-link"
            >
              {{ item.name }}
            </RouterLink>
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
      <tbody v-else>
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
.counter-value { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; max-width: 100%; }
.counter-link { color: inherit; text-decoration: none; }
</style>