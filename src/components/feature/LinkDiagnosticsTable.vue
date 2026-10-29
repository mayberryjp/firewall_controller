<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import DatasetStatus from "@/components/base/DatasetStatus.vue";
import { useControllerStore } from "@/stores/controller";
import { formatTimestamp } from "@/services/timestamps";

const props = defineProps<{ kind: "interfaces" | "queues" | "windows" | "capture" }>();
const labels = { interfaces: "Interface drops", queues: "QDISCS", windows: "TCP WINDOWING", capture: "Capture details" };
const store = useControllerStore();
const data = computed(() => store.linkDiagnostics.data);
const now = ref(Date.now());
let expiry: ReturnType<typeof setTimeout> | undefined;
watch(() => [store.linkDiagnostics.lastSuccess, store.statistics.lastSuccess], function updateFreshness() {
  clearTimeout(expiry); now.value = Date.now();
  const elapsed = store.linkDiagnostics.lastSuccess === null ? 0 : Math.max(0, now.value - store.linkDiagnostics.lastSuccess);
  const deadlines = [5001 - (data.value?.age_ms ?? 5001) - elapsed];
  if (store.statistics.lastSuccess !== null) deadlines.push(5001 - Math.max(0, now.value - store.statistics.lastSuccess));
  const remaining = Math.min(...deadlines.filter(time => time > 0));
  if (Number.isFinite(remaining)) expiry = setTimeout(updateFreshness, remaining);
}, { immediate: true });
onUnmounted(() => clearTimeout(expiry));
const current = computed(() => Boolean(data.value?.status === "available" && !store.linkDiagnostics.stale &&
  data.value.age_ms !== null && store.linkDiagnostics.lastSuccess !== null &&
  data.value.age_ms + Math.max(0, now.value - store.linkDiagnostics.lastSuccess) <= 5000));
const sampleState = computed(() => data.value?.status === "available" && !current.value ? "stale" : data.value?.status ?? "unavailable");
const rows = computed(() => props.kind === "interfaces" ? data.value?.interfaces :
  props.kind === "queues" ? data.value?.queues : props.kind === "capture"
    ? data.value?.packet_headers ? [data.value.packet_headers] : null : data.value?.packet_headers?.interfaces);
const emptyLabel = computed(() => rows.value === null || rows.value === undefined
  ? "Measurements unavailable." : "No observations.");
function value(item: string | number | null | undefined): string | number { return item ?? "Unavailable"; }
function increase(delta: string | null | undefined): string | undefined {
  return current.value && delta !== null && delta !== undefined && BigInt(delta) > 0n ? `+${delta}` : undefined;
}
function decreasePercentage(decreases: string, acknowledgements: string): string {
  const total = BigInt(acknowledgements), events = BigInt(decreases);
  if (total === 0n || events > total) return "Unavailable";
  return `${(Number((events * 10000n + total / 2n) / total) / 100).toFixed(2)}%`;
}
function counterColor(item: string | null | undefined, complete = true): string {
  if (!current.value || item === null || item === undefined) return "default";
  return BigInt(item) > 0n ? "warning" : BigInt(item) === 0n ? complete ? "success" : "default" : "info";
}
const informationColor = computed(() => current.value ? "info" : "default");
const interfaceTraffic = computed(() => {
  const result = new Map<string, { drops: string; color: string }>();
  const query = store.statistics, sample = query.data;
  if (!current.value || !sample || query.stale || query.error || query.lastSuccess === null ||
    now.value - query.lastSuccess > 5000 || !["available", "partial"].includes(sample.sample.status)) return result;
  for (const row of sample.interfaces) {
    if (row.status !== "available" || row.error || row.index === undefined) continue;
    const counters = row.counters;
    const packets = [counters?.rx_packets, counters?.tx_packets];
    if (!packets.every(item => item !== undefined && /^\d+$/.test(item))) continue;
    const total = BigInt(packets[0]!) + BigInt(packets[1]!);
    const drops = [counters?.rx_dropped, counters?.tx_dropped];
    const dropped = drops.every(item => item !== undefined && /^\d+$/.test(item))
      ? BigInt(drops[0]!) + BigInt(drops[1]!) : null;
    result.set(`${row.index}/${row.name}`, {
      drops: dropped === null ? "Unavailable" : decreasePercentage(dropped.toString(), (total + dropped).toString()),
      color: dropped === null || total + dropped === 0n ? "default" : dropped > 0n ? "warning" : "success",
    });
  }
  return result;
});
const sampleLabels: Record<string, string> = {
  available: "Current", starting: "Starting", unavailable: "Unavailable", stale: "Stale", simulated: "Simulated",
};
const details = computed(() => {
  const codes: Record<string, string[]> = {
    interfaces: ["interface_errors", "interface_drops"],
    queues: ["local_egress_drops", "local_queue_growth"],
    windows: ["receiver_window_pressure"],
    capture: [],
  };
  return data.value?.signals.filter(code => codes[props.kind]!.includes(code)) ?? [];
});
onMounted(() => {
  if (store.connected && document.visibilityState !== "hidden") void store.refreshLinkDiagnostics();
});
</script>

<template>
  <section
    :aria-label="labels[kind]"
    class="link-diagnostics"
  >
    <DatasetStatus
      :query="store.linkDiagnostics"
      :label="labels[kind]"
    />
    <div class="d-flex flex-wrap align-center ga-3 mb-4">
      <v-chip
        size="small"
        variant="tonal"
        :color="current ? 'success' : sampleState === 'stale' ? 'warning' : 'default'"
      >
        {{ sampleLabels[sampleState] }}
      </v-chip>
      <span class="text-caption text-medium-emphasis">Collected (UTC): {{ formatTimestamp(data?.collected_at) }}</span>
      <template v-if="(kind === 'windows' || kind === 'capture') && data?.packet_headers">
        <v-chip
          size="small"
          variant="tonal"
          :color="current ? data.packet_headers.statistics_complete ? 'success' : 'warning' : 'default'"
        >
          Capture {{ data.packet_headers.statistics_complete ? 'complete' : 'incomplete' }}{{ current ? '' : ' (historical)' }}
        </v-chip>
      </template>
    </div>
    <p
      v-if="data?.error"
      role="alert"
      class="text-error mb-3"
    >
      {{ data.error }}
    </p>
    <p
      v-if="!current && rows?.length"
      role="status"
      class="text-caption mb-3"
    >
      Historical observations only. Measurements are not current.
    </p>
    <p
      v-else-if="!current"
      role="status"
      class="text-caption mb-3"
    >
      Current measurements are unavailable.{{ sampleState === 'simulated' ? ' The simulator does not fabricate measurements.' : '' }}
    </p>

    <v-table
      v-if="kind === 'interfaces'"
      class="resource-table"
      density="compact"
    >
      <thead>
        <tr>
          <th>Interface</th><th>Errors (RX + TX)</th><th>Errors delta</th><th>Drops (RX + TX)</th><th>Drops delta</th>
          <th title="Cumulative RX + TX drops / (packets + drops) from interface statistics; not a current loss rate">
            Drop percentage
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in data?.interfaces ?? []"
          :key="`${row.index}/${row.name}`"
        >
          <td :title="`Interface index ${row.index}`">
            <v-chip
              size="small"
              variant="tonal"
              color="info"
            >
              {{ row.name }}
            </v-chip>
          </td>
          <td>
            <v-chip
              size="small"
              variant="tonal"
              :color="counterColor(row.errors)"
              title="Cumulative errors, not a current error rate"
            >
              {{ row.errors }}
              <span
                v-if="increase(row.errors_delta)"
                class="ms-2"
                title="Increase since the previous diagnostic sample"
              >{{ increase(row.errors_delta) }}</span>
            </v-chip>
          </td>
          <td>
            <v-chip
              size="small"
              variant="tonal"
              :color="counterColor(row.errors_delta)"
            >
              {{ value(row.errors_delta) }}
            </v-chip>
          </td>
          <td>
            <v-chip
              size="small"
              variant="tonal"
              :color="counterColor(row.drops)"
              title="Cumulative drops, not a current loss rate"
            >
              {{ row.drops }}
              <span
                v-if="increase(row.drops_delta)"
                class="ms-2"
                title="Increase since the previous diagnostic sample"
              >{{ increase(row.drops_delta) }}</span>
            </v-chip>
          </td>
          <td>
            <v-chip
              size="small"
              variant="tonal"
              :color="counterColor(row.drops_delta)"
            >
              {{ value(row.drops_delta) }}
            </v-chip>
          </td>
          <td>
            <v-chip
              size="small"
              variant="tonal"
              :color="interfaceTraffic.get(`${row.index}/${row.name}`)?.color ?? 'default'"
            >
              {{ interfaceTraffic.get(`${row.index}/${row.name}`)?.drops ?? 'Unavailable' }}
            </v-chip>
          </td>
        </tr>
        <tr v-if="!rows?.length">
          <td colspan="6">
            {{ emptyLabel }}
          </td>
        </tr>
      </tbody>
    </v-table>

    <v-table
      v-else-if="kind === 'queues'"
      class="resource-table"
      density="compact"
    >
      <thead><tr><th>Interface</th><th>Kind</th><th>Handle</th><th>Parent</th><th>Status</th><th>Queue (packets)</th><th>Backlog (bytes)</th><th>Growth (bytes)</th><th>Drops</th><th>Drops delta</th><th>Requeues</th><th>Overlimits</th></tr></thead>
      <tbody>
        <tr
          v-for="row in data?.queues ?? []"
          :key="`${row.index}/${row.handle}/${row.parent}/${row.kind}`"
        >
          <td :title="`Interface index ${row.index}`">
            <v-chip
              size="small"
              variant="tonal"
              color="info"
            >
              {{ row.name ?? `Interface ${row.index}` }}
            </v-chip>
          </td>
          <td>
            <v-chip
              size="small"
              variant="tonal"
              color="info"
            >
              {{ row.kind }}
            </v-chip>
          </td>
          <td>{{ row.handle }}</td><td>{{ row.parent }}</td>
          <td>
            <v-chip
              size="small"
              variant="tonal"
              :color="current && row.status === 'available' ? 'success' : 'default'"
            >
              {{ current ? row.status : 'Historical' }}
            </v-chip>
          </td>
          <td>
            <v-chip
              size="small"
              variant="tonal"
              :color="row.queue ? informationColor : 'default'"
            >
              {{ value(row.queue?.qlen_packets) }}
            </v-chip>
          </td>
          <td>
            <v-chip
              size="small"
              variant="tonal"
              :color="row.queue ? informationColor : 'default'"
            >
              {{ value(row.queue?.backlog_bytes) }}
            </v-chip>
          </td>
          <td>
            <v-chip
              size="small"
              variant="tonal"
              :color="counterColor(row.backlog_growth_bytes)"
            >
              {{ value(row.backlog_growth_bytes) }}
            </v-chip>
          </td>
          <td>
            <v-chip
              size="small"
              variant="tonal"
              :color="counterColor(row.queue?.drops)"
              title="Cumulative qdisc drops, not a current loss rate"
            >
              {{ value(row.queue?.drops) }}
              <span
                v-if="increase(row.drops_delta)"
                class="ms-2"
                title="Increase since the previous diagnostic sample"
              >{{ increase(row.drops_delta) }}</span>
            </v-chip>
          </td>
          <td>
            <v-chip
              size="small"
              variant="tonal"
              :color="counterColor(row.drops_delta)"
            >
              {{ value(row.drops_delta) }}
            </v-chip>
          </td>
          <td>
            <v-chip
              size="small"
              variant="tonal"
              :color="counterColor(row.queue?.requeues)"
              title="Cumulative requeues, not proof of packet loss"
            >
              {{ value(row.queue?.requeues) }}
            </v-chip>
          </td>
          <td>
            <v-chip
              size="small"
              variant="tonal"
              :color="counterColor(row.queue?.overlimits)"
              title="Cumulative overlimits do not necessarily mean loss"
            >
              {{ value(row.queue?.overlimits) }}
            </v-chip>
          </td>
        </tr>
        <tr v-if="!rows?.length">
          <td colspan="12">
            {{ emptyLabel }}
          </td>
        </tr>
      </tbody>
    </v-table>

    <template v-else-if="kind === 'windows'">
      <v-table
        class="resource-table"
        density="compact"
      >
        <thead><tr><th>Interface</th><th>TCP ACK packets</th><th>Zero-window observations</th><th>Zero-window transitions</th><th>Window decreases (% of ACKs)</th><th>Minimum raw window</th><th>Maximum raw window</th></tr></thead>
        <tbody>
          <tr
            v-for="row in data?.packet_headers?.interfaces ?? []"
            :key="row.index"
          >
            <td :title="`Interface index ${row.index}`">
              <v-chip
                size="small"
                variant="tonal"
                color="info"
              >
                {{ row.name ?? `Interface ${row.index}` }}
              </v-chip>
            </td>
            <td>
              <v-chip
                size="small"
                variant="tonal"
                :color="informationColor"
              >
                {{ row.tcp_ack_packets }}
              </v-chip>
            </td>
            <td>
              <v-chip
                size="small"
                variant="tonal"
                :color="counterColor(row.zero_window_observations, data?.packet_headers?.statistics_complete)"
                title="Cumulative receiver-pressure observations, not current link failure"
              >
                {{ row.zero_window_observations }}
              </v-chip>
            </td>
            <td>
              <v-chip
                size="small"
                variant="tonal"
                :color="counterColor(row.zero_window_transitions, data?.packet_headers?.statistics_complete)"
                title="Cumulative zero-window transitions"
              >
                {{ row.zero_window_transitions }}
              </v-chip>
            </td>
            <td>
              <v-chip
                size="small"
                variant="tonal"
                :color="counterColor(row.window_decreases, data?.packet_headers?.statistics_complete)"
                title="Cumulative window decreases, not proof of packet loss"
              >
                {{ row.window_decreases }}
              </v-chip>
              <span
                class="text-caption ms-2"
                title="Observed window decreases divided by observed TCP ACK packets since collector start; not a packet-loss rate"
              >{{ decreasePercentage(row.window_decreases, row.tcp_ack_packets) }}</span>
            </td>
            <td>
              <v-chip
                size="small"
                variant="tonal"
                :color="row.window_raw_min === null ? 'default' : informationColor"
              >
                {{ value(row.window_raw_min) }}
              </v-chip>
            </td>
            <td>
              <v-chip
                size="small"
                variant="tonal"
                :color="row.window_raw_max === null ? 'default' : informationColor"
              >
                {{ value(row.window_raw_max) }}
              </v-chip>
            </td>
          </tr>
          <tr v-if="!rows?.length">
            <td colspan="7">
              {{ emptyLabel }}
            </td>
          </tr>
        </tbody>
      </v-table>
    </template>
    <v-table
      v-else
      class="resource-table"
      density="compact"
    >
      <thead>
        <tr>
          <th title="TCP directions currently tracked by the monitor">
            Tracked directions
          </th><th title="Maximum tracked TCP directions">
            Direction limit
          </th><th title="Headers the monitor could not receive in time; not necessarily firewall traffic drops">
            Kernel drops
          </th><th title="Headers the monitor could not interpret">
            Rejected headers
          </th><th title="Observations skipped because tracking was full">
            Capacity rejections
          </th><th title="Interruptions in header monitoring">
            Capture gaps
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="data?.packet_headers">
          <td>
            <v-chip
              size="small"
              variant="tonal"
              :color="informationColor"
            >
              {{ data.packet_headers.tracked_directions }}
            </v-chip>
          </td><td>{{ data.packet_headers.flow_limit }}</td>
          <td>
            <v-chip
              size="small"
              variant="tonal"
              :color="counterColor(data.packet_headers.kernel_drops, data.packet_headers.statistics_complete)"
            >
              {{ data.packet_headers.kernel_drops }}
            </v-chip>
          </td>
          <td>
            <v-chip
              size="small"
              variant="tonal"
              :color="counterColor(data.packet_headers.rejected_headers, data.packet_headers.statistics_complete)"
            >
              {{ data.packet_headers.rejected_headers }}
            </v-chip>
          </td>
          <td>
            <v-chip
              size="small"
              variant="tonal"
              :color="counterColor(data.packet_headers.untracked_packets, data.packet_headers.statistics_complete)"
            >
              {{ data.packet_headers.untracked_packets }}
            </v-chip>
          </td>
          <td>
            <v-chip
              size="small"
              variant="tonal"
              :color="counterColor(data.packet_headers.capture_gaps, data.packet_headers.statistics_complete)"
            >
              {{ data.packet_headers.capture_gaps }}
            </v-chip>
          </td>
        </tr>
        <tr v-else>
          <td colspan="6">
            {{ emptyLabel }}
          </td>
        </tr>
      </tbody>
    </v-table>
    <p class="text-caption text-medium-emphasis mt-3">
      <template v-if="kind === 'interfaces'">
        Packets discarded while entering or leaving a network interface. Increasing drops can indicate overloaded queues, limited resources, or traffic the interface cannot handle, helping explain packet loss and poor performance.
      </template>
      <template v-else-if="kind === 'queues'">
        Queueing disciplines control how outgoing packets are buffered, prioritized, and transmitted. They affect latency and fairness under load; their statistics help identify congestion, queue buildup, and intentional packet drops.
      </template>
      <template v-else-if="kind === 'windows'">
        TCP uses the receiver's advertised window to limit how much unacknowledged data the sender can transmit. Small or zero windows can reveal a receiver struggling to consume data and limit throughput, even when bandwidth is available.
        A zero window means the receiver is advertising no space for more data. The sender pauses normal data transmission and periodically probes until the receiver opens its window again; this does not by itself indicate packet loss or a failed link.
      </template>
      <template v-else>
        Information about how and where packets were recorded, including the interface, filter, captured packet length, and capture losses. These details establish what the capture can show and help distinguish real network problems from missing or truncated capture data.
      </template>
    </p>
    <p
      v-if="details.length"
      class="text-caption mt-2"
    >
      {{ current ? 'Observed evidence' : 'Historical evidence' }}: {{ details.join(', ') }}.
    </p>
  </section>
</template>

<style scoped>
.resource-table :deep(th) { white-space: normal; }
.resource-table :deep(td) { white-space: nowrap; overflow-wrap: normal; }
.resource-table :deep(.v-table__wrapper > table > thead > tr > th),
.resource-table :deep(.v-table__wrapper > table > tbody > tr > td) { padding: 2px 6px; }
</style>
