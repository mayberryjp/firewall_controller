<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useControllerStore } from "@/stores/controller";
import { useTimestamps } from "@/composables/useTimestamps";
import { formatIpProtocol, ipProtocolColor } from "@/services/firewallProtocols";
import { firewallDenyReadError, missingRulePeriods, readMissingRuleHistory, summarizeMissingRules, type MissingRuleHistory } from "@/services/possibleMissingRules";

const store = useControllerStore();
const { formatTimestamp, timeZone } = useTimestamps();
const hours = ref(1), loading = ref(false), error = ref("");
const data = ref<MissingRuleHistory | null>(null);
const since = computed(() => data.value ? Math.max(0, data.value.until - hours.value * 3600000) : 0);
const rows = computed(() => data.value ? summarizeMissingRules(data.value.records, since.value, data.value.until) : []);
const packets = computed(() => rows.value.reduce((total, row) => total + row.packets, 0n));
const bytes = computed(() => rows.value.reduce((total, row) => total + row.bytes, 0n));
let controller: AbortController | undefined, generation = 0, disposed = false;
async function read(): Promise<void> {
  if (loading.value || !store.connected || disposed) return;
  const version = generation;
  loading.value = true; controller = new AbortController();
  try {
    const result = await readMissingRuleHistory(Date.now(), controller.signal);
    if (version !== generation || disposed) return;
    data.value = result; error.value = "";
  } catch (failure) {
    if (version !== generation || disposed) return;
    error.value = firewallDenyReadError(failure);
  } finally {
    if (version === generation) loading.value = false;
  }
}
function reset(): void {
  generation++; controller?.abort(); loading.value = false;
  data.value = null; error.value = "";
  if (store.connected) void read();
}
watch(() => store.sessionVersion, reset);
onMounted(() => { void read(); });
onUnmounted(() => { disposed = true; generation++; controller?.abort(); });
</script>

<template>
  <section
    class="missing-rules-page"
    aria-label="Possible missing rules"
  >
    <h2 class="text-h6 mb-4">
      POSSIBLE MISSING RULES
    </h2>
    <div class="missing-rules-toolbar mb-3">
      <v-select
        v-model="hours"
        label="Time period"
        :items="missingRulePeriods"
        density="compact"
        variant="outlined"
        hide-details
        class="missing-rules-period"
      />
      <v-btn
        icon="mdi-refresh"
        variant="text"
        size="small"
        aria-label="Refresh"
        title="Refresh"
        :loading="loading"
        :disabled="loading || !store.connected"
        @click="read"
      />
    </div>
    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      role="alert"
      class="mb-4"
    >
      {{ error }}
      <p v-if="data">
        Previous totals are retained, not a successful response to this request.
      </p>
    </v-alert>
    <v-progress-linear
      v-if="loading"
      indeterminate
      aria-label="Loading drop summary"
    />
    <template v-if="data">
      <v-alert
        v-for="warning in data.warnings"
        :key="warning"
        type="warning"
        variant="tonal"
        class="mb-4"
      >
        {{ warning }}
      </v-alert>
      <p class="text-caption text-medium-emphasis mb-2">
        Captured input/forward drops only, not total traffic. Retention and capture limits can make totals incomplete.
        These are candidates for review, not recommendations to allow traffic.
      </p>
      <p class="text-caption text-medium-emphasis mb-3">
        Period ({{ timeZone }}): {{ formatTimestamp(since) }} to {{ formatTimestamp(data.until) }}.
        Source ports are ignored.
      </p>
      <p class="missing-rules-totals mb-3">
        <v-chip
          size="small"
          variant="tonal"
          color="info"
        >
          {{ packets.toString() }} packets
        </v-chip>
        <v-chip
          size="small"
          variant="tonal"
          color="primary"
        >
          {{ bytes.toString() }} bytes
        </v-chip>
      </p>
      <v-table
        class="missing-rules-table app-table"
        density="compact"
        aria-label="Possible missing rules"
      >
        <thead>
          <tr>
            <th>Source</th><th>Destination</th><th>Destination port</th><th>Protocol</th>
            <th>Packets</th><th>Bytes</th><th>Ingress</th><th>Egress</th><th>Chain</th><th>Reason</th>
            <th>Last seen ({{ timeZone }})</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.id"
            class="missing-rule-row"
          >
            <td
              data-label="Source"
              class="mono"
            >
              {{ row.source }}
            </td>
            <td
              data-label="Destination"
              class="mono"
            >
              {{ row.destination }}
            </td>
            <td data-label="Destination port">
              <v-chip
                v-if="row.destinationPort !== null"
                size="x-small"
                variant="tonal"
                color="primary"
              >
                {{ row.destinationPort }}
              </v-chip>
              <span v-else>—</span>
            </td>
            <td data-label="Protocol">
              <v-chip
                size="small"
                variant="tonal"
                :color="ipProtocolColor(row.protocol)"
              >
                {{ formatIpProtocol(row.protocol) }}
              </v-chip>
            </td>
            <td data-label="Packets">
              {{ row.packets.toString() }}
            </td>
            <td data-label="Bytes">
              {{ row.bytes.toString() }}
            </td>
            <td data-label="Ingress">
              <div class="missing-rule-chips">
                <v-chip
                  v-for="name in row.ingress"
                  :key="name"
                  size="x-small"
                  variant="tonal"
                  :color="name === 'Unavailable' ? 'grey' : 'primary'"
                >
                  {{ name }}
                </v-chip>
              </div>
            </td>
            <td data-label="Egress">
              <div class="missing-rule-chips">
                <v-chip
                  v-for="name in row.egress"
                  :key="name"
                  size="x-small"
                  variant="tonal"
                  :color="name === 'Unavailable' ? 'grey' : 'secondary'"
                >
                  {{ name }}
                </v-chip>
              </div>
            </td>
            <td data-label="Chain">
              <div class="missing-rule-chips">
                <v-chip
                  v-for="chain in row.chains"
                  :key="chain"
                  size="x-small"
                  variant="tonal"
                  :color="chain === 'input' ? 'info' : 'secondary'"
                >
                  {{ chain }}
                </v-chip>
              </div>
            </td>
            <td data-label="Reason">
              <div class="missing-rule-chips">
                <v-chip
                  v-for="reason in row.reasons"
                  :key="reason"
                  size="small"
                  variant="tonal"
                  :color="reason === 'Default policy' ? 'warning' : 'error'"
                >
                  {{ reason }}
                </v-chip>
              </div>
            </td>
            <td
              :data-label="`Last seen (${timeZone})`"
              class="missing-rule-time"
            >
              <time :datetime="new Date(row.lastSeen).toISOString()">{{ formatTimestamp(row.lastSeen) }}</time>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td colspan="11">
              No retained drops in this period. This does not prove there were no drops.
            </td>
          </tr>
        </tbody>
      </v-table>
    </template>
  </section>
</template>

<style scoped>
.missing-rules-page { min-width: 0; }
.missing-rules-toolbar { display: flex; align-items: center; gap: 8px; }
.missing-rules-period { flex: 0 1 220px; min-width: 0; }
.missing-rules-totals, .missing-rule-chips { display: flex; flex-wrap: wrap; gap: 4px 8px; }
.missing-rules-totals, .missing-rule-time { font-variant-numeric: tabular-nums; }
.missing-rule-time { white-space: nowrap; color: var(--text-secondary); }
.missing-rules-table { border: 1px solid var(--border); border-radius: 6px; }
.missing-rules-table :deep(th) { white-space: nowrap; font-size: 12px; }
.missing-rules-table :deep(td) { font-size: 13px; overflow-wrap: anywhere; }
@media (max-width: 900px) {
  .missing-rules-table :deep(table), .missing-rules-table :deep(tbody) { display: block; width: 100%; }
  .missing-rules-table :deep(thead) { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .missing-rules-table :deep(tbody > tr) { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 12px; padding: 12px 8px; border-bottom: 1px solid var(--border); }
  .missing-rules-table :deep(.v-table__wrapper > table > tbody > tr > td) { min-width: 0; height: auto; padding: 0; border: 0; }
  .missing-rules-table :deep(td[data-label])::before { content: attr(data-label); display: block; font-size: 11px; color: var(--text-muted); }
  .missing-rules-table :deep(td[colspan]) { grid-column: 1 / -1; }
  .missing-rule-time { grid-column: 1 / -1; }
}
</style>
