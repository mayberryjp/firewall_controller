<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useControllerStore } from "@/stores/controller";
import { formatMetric, gatewayHealth, gatewaySampleState } from "@/services/gatewayHealth";
import DatasetStatus from "@/components/base/DatasetStatus.vue";
import JsonPanel from "@/components/base/JsonPanel.vue";
const props = defineProps<{ name?: string; statusOnly?: boolean; summary?: boolean }>();
const store = useControllerStore();
const now = ref(Date.now());
let clock: ReturnType<typeof setInterval> | undefined;
const stored = computed(() => store.activeTransactions.find(item => item.status === "pending_confirmation")?.candidate ?? store.state.data?.desired);
const names = computed(() => [...new Set([
  ...(stored.value?.gateway_monitors.map(item => item.name) ?? []),
  ...(store.gatewayStatistics.data?.monitors.map(item => item.name) ?? []),
])].sort());
const rows = computed(() => names.value.map(name => ({
  name, config: stored.value?.gateway_monitors.find(item => item.name === name),
  data: store.gatewayStatistics.data?.monitors.find(item => item.name === name),
})));
const detailRow = computed(() => rows.value.find(row => row.name === props.name));
const measurements = computed<Record<string, string | number | undefined>>(() => {
  const row = detailRow.value;
  if (!row?.data) return {};
  return {
    ...(row.data.mode || row.config?.mode === "dhcp" ? {
      Mode: row.data.mode ?? row.config?.mode,
      Interface: row.data.interface ?? row.config?.interface ?? "Unavailable",
      "Resolved source": row.data.resolved_source_address ?? "Unavailable",
      "Resolved gateway": row.data.resolved_gateway ?? (row.data.resolved_source_address && row.data.resolved_routing_table !== null && row.data.resolved_routing_table !== undefined ? "Direct" : "Unavailable"),
      "Resolved table": row.data.resolved_routing_table ?? "Unavailable",
      Reason: row.data.reason ?? "None",
    } : {}),
    Sample: label(gatewaySampleState(row.data, row.config, now.value, store.gatewayStatistics.stale), sampleStates),
    Health: gatewayHealth(row.data, row.config, now.value, store.gatewayStatistics.stale),
    Loss: formatMetric(row.data.loss_percent, "%"),
    "Mean RTT": formatMetric(row.data.rtt_avg_ms, "ms"),
    Stddev: formatMetric(row.data.rtt_stddev_ms, "ms"),
    Worker: label(row.data.process_state, workerStates),
    "Minimum RTT": formatMetric(row.data.rtt_min_ms, "ms"),
    "Maximum RTT": formatMetric(row.data.rtt_max_ms, "ms"),
    "P50 RTT": formatMetric(row.data.rtt_p50_ms, "ms"),
    "P95 RTT": formatMetric(row.data.rtt_p95_ms, "ms"),
    "RTT variation": formatMetric(row.data.rtt_variation_ms, "ms"),
    "Variation pairs": row.data.variation_pairs,
    Sent: row.data.sent,
    Received: row.data.received,
    Lost: row.data.lost,
    Pending: row.data.pending,
    Measured: row.data.collected_at ?? "Unavailable",
    Started: row.data.started_at ?? "Unavailable",
    "Health changed": row.data.health_changed_at ?? "Unavailable",
    "Last success": row.data.last_success_at ?? "Unavailable",
  };
});
const summaryMeasurements = computed(() => {
  const values = Object.fromEntries(Object.entries(measurements.value).filter(([key]) =>
    ["Sample", "Health", "Loss", "Mean RTT", "Stddev", "RTT variation", "Sent", "Received", "Lost", "Pending"].includes(key)));
  const data = detailRow.value?.data;
  if (data) for (const [key, [value, unit]] of Object.entries({
    Loss: [data.loss_percent, "%"], "Mean RTT": [data.rtt_avg_ms, "ms"],
    Stddev: [data.rtt_stddev_ms, "ms"], "RTT variation": [data.rtt_variation_ms, "ms"],
  } as const)) values[key] = formatMetric(value === null ? null : Number(value.toFixed(3)), unit);
  return values;
});
onMounted(() => {
  if (!props.name) {
    store.gatewayMonitoring = true;
    void store.refreshGatewayStatistics();
  }
  clock = setInterval(() => { now.value = Date.now(); }, 500);
});
onUnmounted(() => { if (!props.name) store.gatewayMonitoring = false; clearInterval(clock); });
const workerStates = ["disabled", "simulated", "not_running", "running", "exited", "waiting", "error"];
const sampleStates = ["disabled", "simulated", "warming_up", "available", "stale", "unavailable", "waiting_for_dhcp"];
function label(state: string, known: string[]): string {
  if (state === "waiting_for_dhcp") return "Waiting for DHCP";
  return known.includes(state) ? state : `Unknown (${state})`;
}
</script>
<template>
  <section
    :class="summary ? 'monitor-summary-panel' : 'my-4'"
    :aria-label="name ? `${name} ${summary ? 'probe' : 'live'} statistics` : 'Gateway health statistics'"
  >
    <DatasetStatus
      v-if="!name"
      :query="store.gatewayStatistics"
      label="Independent cached gateway statistics"
    />
    <template v-if="name">
      <dl
        v-if="detailRow?.data"
        :class="['monitor-measurements', { 'monitor-summary': summary }]"
      >
        <div
          v-for="(value, key) in summary ? summaryMeasurements : measurements"
          :key="key"
        >
          <dt>{{ key }}</dt>
          <dd :title="summary ? String(measurements[key]) : undefined">
            {{ value }}
          </dd>
        </div>
      </dl>
      <p v-else>
        Unknown (no monitor sample)
      </p>
      <p v-if="summary && detailRow?.data?.reason">
        {{ detailRow.data.reason }}
      </p>
      <p
        v-if="detailRow?.data?.error"
        role="alert"
      >
        {{ detailRow.data.error }}
      </p>
    </template>
    <v-table v-else-if="!statusOnly">
      <thead><tr><th>Monitor</th><th>Sample</th><th>Health</th><th>Loss</th><th>Mean RTT</th><th>Stddev</th><th>Details</th></tr></thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.name"
        >
          <td>{{ row.name }}</td>
          <template v-if="row.data">
            <td>{{ label(gatewaySampleState(row.data, row.config, now, store.gatewayStatistics.stale), sampleStates) }}</td>
            <td>{{ gatewayHealth(row.data, row.config, now, store.gatewayStatistics.stale) }}</td>
            <td>{{ formatMetric(row.data.loss_percent, "%") }}</td>
            <td>{{ formatMetric(row.data.rtt_avg_ms, "ms") }}</td>
            <td>{{ formatMetric(row.data.rtt_stddev_ms, "ms") }}</td>
            <td>
              <JsonPanel
                label="Measurements"
                :value="{
                  worker: label(row.data.process_state, workerStates),
                  minimum_RTT: formatMetric(row.data.rtt_min_ms, 'ms'),
                  maximum_RTT: formatMetric(row.data.rtt_max_ms, 'ms'),
                  p50_RTT: formatMetric(row.data.rtt_p50_ms, 'ms'),
                  p95_RTT: formatMetric(row.data.rtt_p95_ms, 'ms'),
                  RTT_variation: formatMetric(row.data.rtt_variation_ms, 'ms'),
                  variation_pairs: row.data.variation_pairs,
                  window_sent: row.data.sent,
                  window_received: row.data.received,
                  window_lost: row.data.lost,
                  window_pending: row.data.pending,
                  measured: row.data.collected_at,
                  started: row.data.started_at,
                  health_changed: row.data.health_changed_at,
                  last_success: row.data.last_success_at,
                  mode: row.data.mode,
                  interface: row.data.interface,
                  resolved_source: row.data.resolved_source_address,
                  resolved_gateway: row.data.resolved_gateway,
                  resolved_table: row.data.resolved_routing_table,
                  reason: row.data.reason,
                }"
              />
              <p v-if="row.data.reason">
                {{ row.data.reason }}
              </p>
              <p
                v-if="row.data.error"
                role="alert"
              >
                {{ row.data.error }}
              </p>
            </td>
          </template>
          <td
            v-else
            colspan="6"
          >
            Unknown (no monitor sample)
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="7">
            No gateway monitor records available.
          </td>
        </tr>
      </tbody>
    </v-table>
  </section>
</template>

<style scoped>
.monitor-measurements { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(160px, 100%), 1fr)); gap: 16px; margin: 0; }
.monitor-measurements > div { min-width: 0; }
.monitor-measurements dt { color: rgba(var(--v-theme-on-surface), 0.7); font-size: 12px; }
.monitor-measurements dd { margin: 4px 0 0; overflow-wrap: anywhere; }
.monitor-summary-panel { margin: 4px 0 12px; }
.monitor-summary { grid-template-columns: repeat(auto-fit, minmax(min(100px, 100%), 1fr)); gap: 12px; }
</style>
