<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useControllerStore } from "@/stores/controller";
import { useTimestamps } from "@/composables/useTimestamps";
import { useHostnames } from "@/composables/useHostnames";
import FirewallDropVisibility from "@/components/feature/FirewallDropVisibility.vue";
import { visibleFirewallDrops } from "@/services/firewallTelemetry";
import { formatIpProtocol, ipProtocolColor } from "@/services/firewallProtocols";
import { firewallDenyReadError, missingRulePeriods, readMissingRuleHistory, sortMissingRules, summarizeMissingRules, type MissingRuleHistory, type MissingRuleSortColumn } from "@/services/possibleMissingRules";

const store = useControllerStore();
const { formatTimestamp, timeZone } = useTimestamps();
const { formatHostAddress } = useHostnames();
const hours = ref(1), loading = ref(false), error = ref("");
const hideBroadcast = ref(true), hideTcp = ref(true);
const data = ref<MissingRuleHistory | null>(null);
const since = computed(() => data.value ? Math.max(0, data.value.until - hours.value * 3600000) : 0);
const periodRecords = computed(() => data.value?.records.filter(row => row.timestamp_ms >= since.value && row.timestamp_ms <= data.value!.until) ?? []);
const visibleRecords = computed(() => visibleFirewallDrops(periodRecords.value, hideBroadcast.value, hideTcp.value));
const rows = computed(() => data.value ? summarizeMissingRules(visibleRecords.value, since.value, data.value.until) : []);
const columns = computed<Array<{ key: MissingRuleSortColumn; label: string }>>(() => [
  { key: "source", label: "Source" }, { key: "destination", label: "Destination" },
  { key: "destinationPort", label: "Destination port" }, { key: "protocol", label: "Protocol" },
  { key: "packets", label: "Packets" }, { key: "bytes", label: "Bytes" },
  { key: "ingress", label: "Ingress" }, { key: "egress", label: "Egress" },
  { key: "chains", label: "Chain" }, { key: "reasons", label: "Reason" },
  { key: "lastSeen", label: `Last seen (${timeZone.value})` },
]);
const sortColumn = ref<MissingRuleSortColumn>("packets"), sortDescending = ref(true);
const sortedRows = computed(() => sortMissingRules(rows.value, sortColumn.value, sortDescending.value));
function sort(column: MissingRuleSortColumn): void {
  sortDescending.value = sortColumn.value === column ? !sortDescending.value : false;
  sortColumn.value = column;
}
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
      <FirewallDropVisibility
        v-model:hide-broadcast="hideBroadcast"
        v-model:hide-tcp="hideTcp"
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
      <div class="missing-rules-mobile-sort mb-3">
        <v-select
          :model-value="sortColumn"
          label="Sort by"
          :items="columns.map(column => ({ title: column.label, value: column.key }))"
          density="compact"
          variant="outlined"
          hide-details
          @update:model-value="sort"
        />
        <v-btn
          :icon="sortDescending ? 'mdi-arrow-down' : 'mdi-arrow-up'"
          variant="text"
          size="small"
          :aria-label="`Sort ${sortDescending ? 'ascending' : 'descending'}`"
          :title="`Sort ${sortDescending ? 'ascending' : 'descending'}`"
          @click="sortDescending = !sortDescending"
        />
      </div>
      <v-table
        class="missing-rules-table app-table"
        density="compact"
        aria-label="Possible missing rules"
      >
        <thead>
          <tr>
            <th
              v-for="column in columns"
              :key="column.key"
              scope="col"
              :aria-sort="sortColumn === column.key ? (sortDescending ? 'descending' : 'ascending') : 'none'"
            >
              <button
                type="button"
                class="missing-rule-sort"
                :title="`Sort by ${column.label.toLowerCase()} ${sortColumn === column.key && !sortDescending ? 'descending' : 'ascending'}`"
                @click="sort(column.key)"
              >
                {{ column.label }}
                <v-icon
                  :icon="sortColumn === column.key ? (sortDescending ? 'mdi-arrow-down' : 'mdi-arrow-up') : 'mdi-unfold-more-horizontal'"
                  size="14"
                  aria-hidden="true"
                />
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in sortedRows"
            :key="row.id"
            class="missing-rule-row"
          >
            <td
              data-label="Source"
              class="mono"
            >
              {{ formatHostAddress(row.source) }}
            </td>
            <td
              data-label="Destination"
              class="mono"
            >
              {{ formatHostAddress(row.destination) }}
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
              {{ periodRecords.length ? "No drops are visible with these hide filters." : "No retained drops in this period. This does not prove there were no drops." }}
            </td>
          </tr>
        </tbody>
      </v-table>
    </template>
  </section>
</template>

<style scoped>
.missing-rules-page { min-width: 0; }
.missing-rules-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; }
.missing-rules-period { flex: 0 1 220px; min-width: 0; }
.missing-rules-totals, .missing-rule-chips { display: flex; flex-wrap: wrap; gap: 4px 8px; }
.missing-rules-totals, .missing-rule-time { font-variant-numeric: tabular-nums; }
.missing-rule-time { white-space: nowrap; color: var(--text-secondary); }
.missing-rules-table { border: 1px solid var(--border); border-radius: 6px; }
.missing-rules-table :deep(th) { white-space: nowrap; font-size: 12px; }
.missing-rule-sort { display: inline-flex; align-items: center; gap: 4px; min-height: 40px; color: inherit; font: inherit; cursor: pointer; }
.missing-rule-sort:hover, .missing-rules-table :deep(th[aria-sort="ascending"]), .missing-rules-table :deep(th[aria-sort="descending"]) { color: var(--text-primary); }
.missing-rule-sort:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 2px; }
.missing-rules-mobile-sort { display: none; }
.missing-rules-table :deep(td) { font-size: 13px; overflow-wrap: anywhere; }
@media (max-width: 900px) {
  .missing-rules-mobile-sort { display: flex; align-items: center; gap: 8px; }
  .missing-rules-mobile-sort :deep(.v-input) { flex: 1; min-width: 0; }
  .missing-rules-table :deep(table), .missing-rules-table :deep(tbody) { display: block; width: 100%; }
  .missing-rules-table :deep(thead) { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .missing-rules-table :deep(tbody > tr) { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 12px; padding: 12px 8px; border-bottom: 1px solid var(--border); }
  .missing-rules-table :deep(.v-table__wrapper > table > tbody > tr > td) { min-width: 0; height: auto; padding: 0; border: 0; }
  .missing-rules-table :deep(td[data-label])::before { content: attr(data-label); display: block; font-size: 11px; color: var(--text-muted); }
  .missing-rules-table :deep(td[colspan]) { grid-column: 1 / -1; }
  .missing-rule-time { grid-column: 1 / -1; }
}
</style>
