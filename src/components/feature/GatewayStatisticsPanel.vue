<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useControllerStore } from "@/stores/controller";
import { formatMetric, gatewayHealth, gatewaySampleState } from "@/services/gatewayHealth";
import DatasetStatus from "@/components/base/DatasetStatus.vue";
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
onMounted(() => {
  store.gatewayMonitoring = true;
  void store.refreshGatewayStatistics();
  clock = setInterval(() => { now.value = Date.now(); }, 500);
});
onUnmounted(() => { store.gatewayMonitoring = false; clearInterval(clock); });
const workerStates = ["disabled", "simulated", "not_running", "running", "exited"];
const sampleStates = ["disabled", "simulated", "warming_up", "available", "stale", "unavailable"];
function label(state: string, known: string[]): string { return known.includes(state) ? state : `Unknown (${state})`; }
</script>
<template>
  <section
    class="my-6"
    aria-label="Gateway health statistics"
  >
    <h2 class="text-h5 mb-3">
      Gateway health and RTT
    </h2>
    <DatasetStatus
      :query="store.gatewayStatistics"
      label="Independent cached gateway statistics"
    />
    <p
      v-if="store.gatewayStatistics.data"
      class="mb-3"
    >
      Retrieval {{ store.gatewayStatistics.data.sample.started_at }} – {{ store.gatewayStatistics.data.sample.collected_at }} · {{ store.gatewayStatistics.data.sample.status }} · {{ store.gatewayStatistics.data.sample.scope }}.
      Per-row collected time is measurement freshness, not retrieval time.
    </p>
    <v-alert
      type="info"
      variant="tonal"
      class="mb-4"
    >
      Simulated is not real reachability. Local path/socket errors, stale samples and warmup are Unknown, not remote Down.
      Default policy: 30-second full-window warmup, 100% finalized loss Down; 20% loss or 150 ms mean RTT Degraded, variation threshold disabled. Failure hold 3s / recovery hold 5s; window effects add delay. Per-monitor settings may differ.
      Null is unavailable, never zero RTT. Loss excludes pending probes. RTT variation is mean absolute difference between adjacent transmitted probes that both replied; lost/pending gaps are never bridged. It is not one-way/RTP jitter.
    </v-alert>
    <v-table>
      <thead><tr><th>Monitor / stored enabled</th><th>Worker</th><th>Sample</th><th>Health</th><th>Loss</th><th>RTT min / max / mean</th><th>Population stddev / p50 / p95</th><th>RTT variation / pairs</th><th>Window sent / received / lost / pending</th><th>Freshness / diagnostics</th></tr></thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.name"
        >
          <td>{{ row.name }} · {{ row.config?.enabled ?? "Unknown" }}</td>
          <template v-if="row.data">
            <td>{{ label(row.data.process_state, workerStates) }}</td>
            <td>{{ label(gatewaySampleState(row.data, row.config, now, store.gatewayStatistics.stale), sampleStates) }}</td>
            <td>{{ gatewayHealth(row.data, row.config, now, store.gatewayStatistics.stale) }}</td>
            <td>{{ formatMetric(row.data.loss_percent, "%") }}</td>
            <td>{{ formatMetric(row.data.rtt_min_ms, "ms") }} / {{ formatMetric(row.data.rtt_max_ms, "ms") }} / {{ formatMetric(row.data.rtt_avg_ms, "ms") }}</td>
            <td>{{ formatMetric(row.data.rtt_stddev_ms, "ms") }} / {{ formatMetric(row.data.rtt_p50_ms, "ms") }} / {{ formatMetric(row.data.rtt_p95_ms, "ms") }}</td>
            <td>{{ formatMetric(row.data.rtt_variation_ms, "ms") }} / {{ row.data.variation_pairs }}</td>
            <td>{{ row.data.sent }} / {{ row.data.received }} / {{ row.data.lost }} / {{ row.data.pending }}</td>
            <td>
              Measured {{ row.data.collected_at ?? "Unknown" }}<br>Started {{ row.data.started_at ?? "Unknown" }}<br>
              Health changed {{ row.data.health_changed_at ?? "Unknown" }}<br>
              Last success {{ row.data.last_success_at ?? "None" }} (since worker start, may predate window)
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
            colspan="9"
          >
            Unknown (no monitor sample)
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="10">
            No gateway monitor records available.
          </td>
        </tr>
      </tbody>
    </v-table>
    <p class="text-caption mt-3">
      Counts are rolling-window observations, not lifetime counters or traffic rates. Sent = received + lost + pending. Stale after max(1 second, 3 configured probe intervals). Repair/restart or affected networking changes reset measurements. Health never changes desired enabled, routing or modeled configuration drift.
    </p>
  </section>
</template>
