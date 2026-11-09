<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { ZodError } from "zod";
import { useControllerStore } from "@/stores/controller";
import { getFirewallDenyLog } from "@/services/netcontrol";
import { firewallDenyReadError } from "@/services/possibleMissingRules";
import { formatIpProtocol, ipProtocolColor } from "@/services/firewallProtocols";
import { firewallDenyQuerySchema, firewallDropReasonLabel, sortFirewallDrops, type FirewallDenyPage, type FirewallDenyQuery, type FirewallDropSortColumn } from "@/services/firewallTelemetry";
import { useTimestamps } from "@/composables/useTimestamps";
import { useHostnames } from "@/composables/useHostnames";
import FirewallDropVisibility from "@/components/feature/FirewallDropVisibility.vue";
const { formatTimestamp, parseTimestamp, timeZone } = useTimestamps();
const { formatHostAddress, hostnamesError } = useHostnames();

const store = useControllerStore();
const data = ref<FirewallDenyPage | null>(null), loading = ref(false), error = ref(""), filterError = ref("");
const showFilters = ref(false);
const includeBroadcast = ref(false), includeTcp = ref(false);
const filters = reactive({ address: "", protocol: "", chain: "", since: "", until: "" });
const pageSize = 100, page = ref(1);
const query = ref<FirewallDenyQuery>({ limit: pageSize, include_broadcast: false, include_tcp_closures: false });
const chains = [{ title: "All chains", value: "" }, { title: "Input", value: "input" }, { title: "Forward", value: "forward" }];
const columns = computed<Array<{ key: FirewallDropSortColumn; label: string }>>(() => [
  { key: "timestamp_ms", label: `Time (${timeZone.value})` },
  { key: "source", label: "Source / port" }, { key: "destination", label: "Destination / port" },
  { key: "protocol", label: "Protocol" }, { key: "ingress", label: "Ingress" },
  { key: "egress", label: "Egress" }, { key: "packet_length", label: "Bytes" }, { key: "reason", label: "Reason" },
]);
const sortColumn = ref<FirewallDropSortColumn | null>(null), sortDescending = ref(false);
const sortedRows = computed(() => sortColumn.value
  ? sortFirewallDrops(data.value?.records ?? [], sortColumn.value, sortDescending.value)
  : data.value?.records ?? []);
const pageCount = computed(() => Math.max(1, Math.ceil(sortedRows.value.length / pageSize)));
const pagedRows = computed(() => sortedRows.value.slice((page.value - 1) * pageSize, page.value * pageSize));
watch([includeBroadcast, includeTcp], () => {
  query.value = { ...query.value, include_broadcast: includeBroadcast.value, include_tcp_closures: includeTcp.value };
  reset();
});
watch(pageCount, count => { page.value = Math.min(page.value, count); });
function sort(column: FirewallDropSortColumn): void {
  sortDescending.value = sortColumn.value === column ? !sortDescending.value : false;
  sortColumn.value = column;
  page.value = 1;
}
const losses = computed(() => {
  const capture = data.value?.capture;
  if (!capture) return [];
  return [
    { label: "Discarded records", value: capture.discarded_records },
    { label: "Malformed records", value: capture.malformed_records },
    { label: "Socket overflow events", value: capture.overflow_events },
    { label: "Sequence gaps", value: capture.sequence_gaps },
  ].filter(item => item.value !== "0");
});
let controller: AbortController | undefined, generation = 0, disposed = false;
async function read(nextQuery: FirewallDenyQuery, older = false): Promise<void> {
  if (loading.value || !store.connected || disposed) return;
  const version = generation;
  let cursor = older ? data.value?.next_before_id : undefined;
  if (older && !cursor) return;
  const initialRecords = data.value?.records ?? [];
  const remaining = () => pageSize - ((data.value?.records.length ?? 0) - initialRecords.length);
  loading.value = true; controller = new AbortController();
  try {
    do {
      const result = await getFirewallDenyLog({
        ...nextQuery, limit: older ? Math.min(pageSize, remaining()) : nextQuery.limit,
        before_id: cursor ?? undefined,
      }, controller.signal);
      if (version !== generation || disposed) return;
      if (cursor && result.next_before_id && BigInt(result.next_before_id) >= BigInt(cursor)) throw new Error("The backend returned a non-advancing history cursor.");
      if (older && data.value) {
        const ids = new Set(data.value.records.map(row => row.id));
        data.value = {
          ...result, records: [...data.value.records, ...result.records.filter(row => !ids.has(row.id))],
          cursor_expired: data.value.cursor_expired || result.cursor_expired,
        };
      } else {
        data.value = result;
        page.value = 1;
      }
      query.value = nextQuery; error.value = "";
      cursor = result.next_before_id;
    } while (older && cursor && remaining() > 0);
  } catch (failure) {
    if (version !== generation || disposed) return;
    error.value = firewallDenyReadError(failure);
  } finally { if (version === generation) loading.value = false; }
}
function applyFilters(): void {
  filterError.value = "";
  try {
    const next = firewallDenyQuerySchema.parse({
      limit: pageSize, address: filters.address.trim() || undefined,
      protocol: filters.protocol.trim() === "" ? undefined : Number(filters.protocol),
      chain: filters.chain || undefined, since_ms: parseTimestamp(filters.since), until_ms: parseTimestamp(filters.until),
      include_broadcast: includeBroadcast.value, include_tcp_closures: includeTcp.value,
    });
    query.value = next;
    reset();
  } catch (failure) {
    filterError.value = failure instanceof ZodError ? failure.issues.map(issue => issue.message).join("; ")
      : failure instanceof Error ? failure.message : "Invalid drop-history filters.";
  }
}
function reset(): void {
  generation++; controller?.abort(); loading.value = false;
  data.value = null; error.value = ""; page.value = 1;
  if (store.connected) void read(query.value);
}
watch(() => store.sessionVersion, reset);
onMounted(() => { void read(query.value); });
onUnmounted(() => { disposed = true; generation++; controller?.abort(); });
</script>

<template>
  <section
    class="drops-page"
    aria-label="Firewall drops"
  >
    <div class="drop-heading">
      <h2 class="text-h6">
        FIREWALL DROPS
      </h2>
    </div>
    <form
      class="drop-filters mb-3"
      aria-label="Drop filters"
      @submit.prevent="applyFilters"
    >
      <div class="drop-toolbar">
        <v-text-field
          v-model="filters.address"
          label="Source or destination IP"
          prepend-inner-icon="mdi-magnify"
          autocomplete="off"
          density="compact"
          variant="outlined"
          hide-details
          class="drop-search"
        />
        <v-text-field
          v-model="filters.protocol"
          label="IP protocol (0–255)"
          type="number"
          min="0"
          max="255"
          density="compact"
          variant="outlined"
          hide-details
          class="drop-protocol-filter"
        />
        <v-select
          v-model="filters.chain"
          label="Chain"
          :items="chains"
          density="compact"
          variant="outlined"
          hide-details
          class="drop-chain-filter"
        />
        <div class="drop-visibility-controls">
          <v-btn
            type="submit"
            icon="mdi-magnify"
            variant="tonal"
            size="small"
            aria-label="Apply filters"
            title="Apply filters"
            :disabled="loading"
          />
          <v-btn
            icon="mdi-filter-variant"
            variant="text"
            size="small"
            aria-label="More filters"
            title="More filters"
            :aria-expanded="showFilters"
            :color="showFilters ? 'primary' : undefined"
            @click="showFilters = !showFilters"
          />
          <FirewallDropVisibility
            v-model:include-broadcast="includeBroadcast"
            v-model:include-tcp="includeTcp"
          />
        </div>
        <v-btn
          class="drop-refresh"
          icon="mdi-refresh"
          variant="text"
          size="small"
          aria-label="Refresh"
          title="Refresh"
          :loading="loading"
          :disabled="loading || !store.connected"
          @click="read(query)"
        />
      </div>
      <div
        v-if="showFilters"
        class="drop-advanced"
      >
        <v-text-field
          v-model="filters.since"
          :label="`Since (${timeZone})`"
          placeholder="yyyy-mm-dd hh:mm:ss"
          density="compact"
          variant="outlined"
          hide-details
        />
        <v-text-field
          v-model="filters.until"
          :label="`Until (${timeZone})`"
          placeholder="yyyy-mm-dd hh:mm:ss"
          density="compact"
          variant="outlined"
          hide-details
        />
      </div>
    </form>
    <v-alert
      v-if="hostnamesError"
      type="error"
      variant="tonal"
      class="mb-3"
      role="alert"
    >
      {{ hostnamesError }}
    </v-alert>
    <v-alert
      v-if="filterError || error"
      type="error"
      variant="tonal"
      role="alert"
      class="mb-4"
    >
      {{ filterError || error }}
      <p v-if="error && data">
        Previous results are retained, not a successful response to this request.
      </p>
    </v-alert>
    <v-progress-linear
      v-if="loading"
      indeterminate
    />
    <template v-if="data">
      <v-alert
        v-if="data.cursor_expired"
        type="warning"
        variant="tonal"
        class="mb-4"
      >
        Retention gap: older records have expired. This is not the complete history.
      </v-alert>
      <v-alert
        v-if="data.capture.status === 'disabled' && !data.capture.error"
        type="info"
        variant="tonal"
        class="mb-4"
      >
        Drop logging is disabled. Existing history is retained; new drops are not recorded.
        Discord alerts depend on drop logging.
      </v-alert>
      <v-alert
        v-else-if="data.capture.status !== 'capturing' || data.capture.error"
        type="warning"
        variant="tonal"
        class="mb-4"
      >
        Capture: {{ data.capture.status }}. {{ data.capture.error }}
        <span v-if="['error', 'stopped'].includes(data.capture.status)">Retained history is shown; current capture is not healthy. Repair the backend capture/storage and restart the daemon.</span>
      </v-alert>
      <v-alert
        v-if="losses.length"
        type="warning"
        variant="tonal"
        class="mb-4"
      >
        Capture loss indicators (daemon session):
        {{ losses.map(item => `${item.label}: ${item.value}`).join('; ') }}.
        These indicators overlap and are not an exact lost-packet total.
      </v-alert>
      <v-table
        class="drop-table app-table"
        density="compact"
        aria-label="Firewall drops"
      >
        <thead>
          <tr>
            <th
              v-for="column in columns"
              :key="column.key"
              scope="col"
              :class="{ 'drop-bytes-heading': column.key === 'packet_length' }"
              :aria-sort="sortColumn === column.key ? (sortDescending ? 'descending' : 'ascending') : 'none'"
            >
              <button
                type="button"
                class="drop-sort"
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
          <template
            v-for="row in pagedRows"
            :key="row.id"
          >
            <tr class="drop-row">
              <td
                class="drop-time"
                :data-label="`Time (${timeZone})`"
              >
                <time :datetime="new Date(row.timestamp_ms).toISOString()">{{ formatTimestamp(row.timestamp_ms) }}</time>
              </td>
              <td
                class="drop-endpoint"
                data-label="Source / port"
              >
                <div class="drop-endpoint-value">
                  <span
                    class="mono"
                    :title="formatHostAddress(row.source)"
                  >{{ formatHostAddress(row.source) }}</span>
                  <v-chip
                    v-if="row.source_port !== null"
                    size="x-small"
                    variant="tonal"
                    color="primary"
                    :title="`Source port ${row.source_port}`"
                  >
                    {{ row.source_port }}
                  </v-chip>
                  <span
                    v-else
                    class="text-medium-emphasis"
                  >—</span>
                </div>
              </td>
              <td
                class="drop-endpoint"
                data-label="Destination / port"
              >
                <div class="drop-endpoint-value">
                  <span
                    class="mono"
                    :title="formatHostAddress(row.destination)"
                  >{{ formatHostAddress(row.destination) }}</span>
                  <v-chip
                    v-if="row.destination_port !== null"
                    size="x-small"
                    variant="tonal"
                    color="primary"
                    :title="`Destination port ${row.destination_port}`"
                  >
                    {{ row.destination_port }}
                  </v-chip>
                  <span
                    v-else
                    class="text-medium-emphasis"
                  >—</span>
                </div>
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
              <td data-label="Ingress">
                {{ row.ingress ?? '—' }}
              </td>
              <td data-label="Egress">
                {{ row.egress ?? '—' }}
              </td>
              <td
                class="drop-number"
                data-label="Bytes"
              >
                {{ row.packet_length }}
              </td>
              <td data-label="Reason">
                <div class="drop-chips">
                  <v-chip
                    size="x-small"
                    variant="tonal"
                    :color="row.chain === 'input' ? 'info' : 'secondary'"
                  >
                    {{ row.chain }}
                  </v-chip>
                  <v-chip
                    size="small"
                    variant="tonal"
                    :color="row.reason === 'policy' ? 'warning' : 'error'"
                  >
                    {{ firewallDropReasonLabel(row.reason) }}
                  </v-chip>
                </div>
              </td>
            </tr>
          </template>
          <tr v-if="!sortedRows.length">
            <td colspan="8">
              {{ data.oldest_id === null && data.newest_id === null ? "No retained firewall drops." : "No retained drops match these filters." }}
            </td>
          </tr>
        </tbody>
      </v-table>
      <div class="drop-footer">
        <span class="text-caption text-medium-emphasis">{{ pagedRows.length }} of {{ sortedRows.length }} drops shown</span>
        <v-pagination
          v-if="pageCount > 1"
          v-model="page"
          :length="pageCount"
          :total-visible="5"
          density="compact"
          aria-label="Firewall drop pages"
        />
        <v-btn
          v-if="data.next_before_id"
          variant="text"
          append-icon="mdi-chevron-down"
          size="small"
          :disabled="loading"
          @click="read(query, true)"
        >
          Load older
        </v-btn>
      </div>
    </template>
  </section>
</template>

<style scoped>
.drops-page { min-width: 0; }
.drop-heading { display: flex; align-items: center; margin-bottom: 16px; }
.drop-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.drop-search { flex: 1 1 220px; max-width: 360px; min-width: 0; }
.drop-protocol-filter { flex: 0 1 180px; min-width: 150px; }
.drop-visibility-controls { display: flex; align-items: center; gap: 8px; min-width: 0; }
.drop-chain-filter { flex: 0 1 150px; min-width: 130px; }
.drop-refresh { margin-left: auto; }
.drop-advanced { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 12px; max-width: 600px; }
.drop-table { background: #090c10; border: 1px solid var(--border); border-radius: 6px; }
.drop-table :deep(.v-table__wrapper > table > thead > tr > th), .drop-table :deep(.v-table__wrapper > table > tbody > tr > td) { padding: 6px 8px; }
.drop-table :deep(th) { white-space: nowrap; color: var(--text-secondary); font-size: 12px; font-weight: 600; }
.drop-sort { display: inline-flex; align-items: center; gap: 4px; min-height: 32px; color: inherit; font: inherit; cursor: pointer; }
.drop-sort:hover, .drop-table :deep(th[aria-sort="ascending"]), .drop-table :deep(th[aria-sort="descending"]) { color: var(--text-primary); }
.drop-sort:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 2px; }
.drop-table :deep(td) { vertical-align: middle; font-size: 13px; }
.drop-row:hover { background: var(--bg-hover); }
.drop-time { white-space: nowrap; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.drop-endpoint { width: 30%; min-width: 120px; }
.drop-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
.drop-endpoint-value { display: flex; align-items: center; gap: 8px; min-width: 0; width: 100%; }
.drop-endpoint-value .mono { flex: 1 1 0; white-space: nowrap; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.drop-endpoint-value > :not(.mono) { flex-shrink: 0; }
.drop-table :deep(.drop-bytes-heading), .drop-number { width: 1%; }
.drop-number { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.drop-footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 0; }
@media (max-width: 600px) {
  .drop-search { flex-basis: 100%; max-width: none; }
  .drop-visibility-controls { flex-wrap: wrap; }
  .drop-advanced { grid-template-columns: minmax(0, 1fr); }
  .drop-table :deep(table), .drop-table :deep(tbody) { display: block; width: 100%; }
  .drop-table :deep(thead) { display: block; overflow-x: auto; }
  .drop-table :deep(thead tr) { display: flex; }
  .drop-table :deep(th) { flex-shrink: 0; }
  .drop-table :deep(.drop-bytes-heading) { width: auto; }
  .drop-table :deep(tbody > tr) { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 12px; padding: 12px 8px; border-bottom: 1px solid var(--border); }
  .drop-table :deep(.v-table__wrapper > table > tbody > tr > td) { min-width: 0; max-width: none; height: auto; padding: 0; border: 0; overflow-wrap: anywhere; }
  .drop-table :deep(td[data-label])::before { content: attr(data-label); display: block; font-size: 11px; color: var(--text-muted); }
  .drop-time, .drop-endpoint { grid-column: 1 / -1; }
  .drop-endpoint, .drop-number { width: auto; }
  .drop-number { text-align: left; }
  .drop-table :deep(td[colspan]) { grid-column: 1 / -1; }
}
</style>
