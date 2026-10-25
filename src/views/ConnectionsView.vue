<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useControllerStore } from "@/stores/controller";
import { getConnections, connectionSelector, deleteConnection, deleteAllConnections, type ConnectionsQuery } from "@/services/netcontrol";
import { ApiFailure } from "@/services/api";
import { formatTimestamp } from "@/services/timestamps";
import type { Connection, ConnectionsPage } from "@/types/domain";

const store = useControllerStore();
const data = ref<ConnectionsPage | null>(null), loading = ref(false), error = ref("");
const filterError = ref("");
const showFilters = ref(false);
const live = ref(true), stale = ref(false);
const deleteDialog = ref(false), deleting = ref(false), deleteError = ref(""), deleteNotice = ref("");
const selectedConnection = ref<Connection | null>(null), selectedScope = ref("");
const deleteBlocked = computed(() => !store.connected || store.busy || store.incompatible || Boolean(store.uncertain || store.submitted) ||
  store.upgradePending || Boolean(store.upgradeBlockedReason) || store.activeTransactions.length > 0 || !data.value || stale.value || Boolean(error.value));
let refreshQueued = false;
function reviewDeletion(row: Connection | null): void {
  if (deleteBlocked.value || deleting.value || (row && !connectionSelector(row))) return;
  selectedConnection.value = row ? { ...row, original: { ...row.original }, reply: { ...row.reply } } : null;
  selectedScope.value = data.value?.sample.scope ?? ""; deleteError.value = ""; deleteNotice.value = ""; deleteDialog.value = true;
}
async function removeConnections(): Promise<void> {
  if (deleting.value || deleteBlocked.value) return;
  deleting.value = true; deleteError.value = "";
  try {
    await Promise.all([store.checkMaintenance(), store.refreshState(), store.refreshTransactions()]);
    if (deleteBlocked.value || store.state.stale || store.transactions.stale) throw new Error("Refresh current firewall state before deleting connection states");
    const result = selectedConnection.value ? await deleteConnection(selectedConnection.value) : await deleteAllConnections();
    deleteNotice.value = `${result.status === "deleted" ? "Connection state deleted" : "All connection states flushed"} in ${result.scope}. Entries may reappear immediately.`;
    deleteDialog.value = false;
  } catch (failure) {
    if (failure instanceof ApiFailure && failure.status === 404) {
      deleteNotice.value = "Connection identity expired or changed. Snapshot refreshed."; deleteDialog.value = false;
    } else {
      const detail = failure instanceof Error ? failure.message : "Connection deletion failed";
      deleteError.value = failure instanceof ApiFailure && failure.uncertain
        ? `Outcome uncertain; state may be partially removed. Refreshing the snapshot. Do not repeat automatically. ${detail}` : detail;
      if (failure instanceof ApiFailure && failure.uncertain) deleteDialog.value = false;
    }
  } finally {
    deleting.value = false;
    if (loading.value) refreshQueued = true; else await refresh();
  }
}
const stateFilter = ref("");
const stateOptions = computed(() => [
  { title: "All states", value: "" },
  ...[...new Set([...(data.value?.connections.map(row => row.state) ?? []), ...(stateFilter.value ? [stateFilter.value] : [])])]
    .sort().map(value => ({ title: value, value })),
]);
const filters = reactive({ family: "", protocol: "", address: "", port: "", zone: "", limit: 100 });
const query = ref<ConnectionsQuery>({ limit: 100, offset: 0, family: store.ipv6Enabled ? undefined : "ipv4" });
const columns = [
  { key: "protocol", label: "Protocol" }, { key: "source", label: "Source" },
  { key: "destination", label: "Destination" }, { key: "state", label: "State" },
  { key: "sent_packets", label: "Sent packets" }, { key: "received_packets", label: "Received packets" },
  { key: "sent_bytes", label: "Sent bytes" }, { key: "received_bytes", label: "Received bytes" },
  { key: "timeout", label: "Timeout" },
] as const;
type SortColumn = typeof columns[number]["key"];
const sortColumn = ref<SortColumn | null>(null), sortDescending = ref(false);
function sortValue(row: Connection, column: SortColumn): string | bigint | number | null {
  switch (column) {
    case "protocol": return row.protocol_name === "other" ? `IP ${row.protocol}` : row.protocol_name;
    case "source": return row.original.source;
    case "destination": return row.original.destination;
    case "state": return row.state;
    case "sent_packets": return row.original_counters ? BigInt(row.original_counters.packets) : null;
    case "received_packets": return row.reply_counters ? BigInt(row.reply_counters.packets) : null;
    case "sent_bytes": return row.original_counters ? BigInt(row.original_counters.bytes) : null;
    case "received_bytes": return row.reply_counters ? BigInt(row.reply_counters.bytes) : null;
    case "timeout": return row.timeout_seconds;
  }
}
const sortedConnections = computed(() => {
  const rows = (data.value?.connections ?? []).filter(row => (store.ipv6Enabled || row.family === "ipv4") && (!stateFilter.value || row.state === stateFilter.value)), column = sortColumn.value;
  if (!column) return rows;
  return [...rows].sort((first, second) => {
    const firstValue = sortValue(first, column), secondValue = sortValue(second, column);
    if (firstValue === null) return secondValue === null ? 0 : 1;
    if (secondValue === null) return -1;
    const comparison = typeof firstValue === "string" && typeof secondValue === "string"
      ? firstValue.localeCompare(secondValue, undefined, { numeric: true, sensitivity: "base" })
      : firstValue < secondValue ? -1 : firstValue > secondValue ? 1 : 0;
    return sortDescending.value ? -comparison : comparison;
  });
});
function sort(column: SortColumn): void {
  sortDescending.value = sortColumn.value === column ? !sortDescending.value : false;
  sortColumn.value = column;
}
const previousOffset = computed(() => Math.max(0, (query.value.offset ?? 0) - (query.value.limit ?? 100)));
let timer: ReturnType<typeof setTimeout> | undefined, controller: AbortController | undefined;
let disposed = false, failures = 0;
function key(row: Connection): string {
  return JSON.stringify([data.value?.sample.scope, row.zone, row.id, row.family, row.protocol, row.original, row.reply]);
}
function protocolColor(row: Connection): string {
  return ({ tcp: "info", udp: "primary", icmp: "warning", icmpv6: "warning", sctp: "secondary", other: "grey" })[row.protocol_name];
}
function stateColor(state: string): string {
  if (["ESTABLISHED", "ASSURED", "RELATED"].includes(state.toUpperCase())) return "success";
  if (["SYN_SENT", "SYN_RECV", "UNREPLIED", "NEW"].includes(state.toUpperCase())) return "warning";
  if (["TIME_WAIT", "CLOSE", "CLOSED", "FIN_WAIT", "CLOSE_WAIT", "LAST_ACK", "CLOSING"].includes(state.toUpperCase())) return "grey";
  return "info";
}
function bytes(value: string): string {
  const amount = BigInt(value), units = ["B", "KB", "MB", "GB", "TB", "PB", "EB"];
  let divisor = 1n, unit = 0;
  while (amount >= divisor * 1000n && unit < units.length - 1) { divisor *= 1000n; unit++; }
  if (!unit) return `${value} B`;
  const tenths = (amount * 10n + divisor / 2n) / divisor;
  return `${tenths / 10n}.${tenths % 10n} ${units[unit]}`;
}
function schedule(): void {
  clearTimeout(timer);
  if (!disposed && store.connected && live.value && document.visibilityState !== "hidden") {
    timer = setTimeout(() => { void refresh(); }, failures ? Math.min(60000, 5000 * 2 ** Math.min(failures, 4)) : 5000);
  }
}
async function refresh(): Promise<void> {
  if (disposed || loading.value || !store.connected || document.visibilityState === "hidden") return;
  clearTimeout(timer); loading.value = true; controller = new AbortController();
  try {
    const result = await getConnections(query.value, controller.signal);
    if (disposed || !store.connected) return;
    data.value = result; error.value = ""; stale.value = false; failures = 0;
  } catch (failure) {
    if (disposed || controller.signal.aborted) return;
    error.value = failure instanceof Error ? failure.message : "Connection inventory unavailable";
    stale.value = Boolean(data.value); failures++;
    if (failure instanceof ApiFailure && (failure.incompatible || [400, 401, 403, 404].includes(failure.status ?? 0))) live.value = false;
  } finally {
    loading.value = false;
    if (refreshQueued) { refreshQueued = false; void refresh(); } else schedule();
  }
}
function unsigned(value: unknown, max: number, label: string): number | undefined {
  if (value === "" || value === null || value === undefined) return undefined;
  if (!/^(0|[1-9]\d*)$/.test(String(value)) || Number(value) > max) throw new Error(`${label} must be an integer from 0 to ${max}`);
  return Number(value);
}
function apply(): void {
  if (loading.value) return;
  filterError.value = "";
  try {
    const protocol = String(filters.protocol ?? "");
    if (protocol && !["tcp", "udp", "icmp", "icmpv6", "sctp"].includes(protocol)) unsigned(protocol, 255, "Protocol");
    query.value = {
      family: !store.ipv6Enabled ? "ipv4" : filters.family === "ipv4" || filters.family === "ipv6" ? filters.family : undefined,
      protocol: protocol || undefined, address: filters.address || undefined,
      port: unsigned(filters.port, 65535, "Port"), zone: unsigned(filters.zone, 65535, "Zone"), limit: filters.limit, offset: 0,
    };
    data.value = null; error.value = ""; stale.value = false; failures = 0;
    void refresh();
  } catch (failure) { filterError.value = failure instanceof Error ? failure.message : "Invalid filter"; }
}
function page(offset: number): void {
  if (loading.value) return;
  query.value = { ...query.value, offset }; data.value = null; error.value = ""; stale.value = false;
  void refresh();
}
function visibility(): void {
  clearTimeout(timer);
  if (live.value && document.visibilityState !== "hidden") void refresh();
}
watch(live, () => { clearTimeout(timer); if (live.value) void refresh(); });
watch(() => store.ipv6Enabled, enabled => {
  filters.family = "";
  if (!enabled && filters.protocol === "icmpv6") filters.protocol = "";
  query.value = { ...query.value, family: enabled ? undefined : "ipv4", protocol: !enabled && query.value.protocol === "icmpv6" ? undefined : query.value.protocol, offset: 0 };
  void refresh();
});
watch(() => store.connected, connected => {
  if (connected) void refresh();
  else { clearTimeout(timer); controller?.abort(); data.value = null; error.value = ""; deleteDialog.value = false; selectedConnection.value = null; }
});
onMounted(() => { document.addEventListener("visibilitychange", visibility); void refresh(); });
onUnmounted(() => { disposed = true; clearTimeout(timer); controller?.abort(); document.removeEventListener("visibilitychange", visibility); data.value = null; });
</script>

<template>
  <section
    aria-label="Connections"
    class="connections-page"
  >
    <div class="connection-heading">
      <h1 class="text-h6">
        Connections
      </h1>
      <v-chip
        v-if="data"
        size="small"
        variant="tonal"
        color="primary"
      >
        Total: {{ data.summary.total ?? 'Unavailable' }}
      </v-chip>
      <span
        v-if="data"
        class="connection-sample text-caption"
        role="status"
      >
        <v-chip
          size="x-small"
          variant="tonal"
          :color="stale ? 'warning' : !live || data.sample.status === 'simulated' ? 'grey' : 'success'"
        >{{ stale ? 'Stale' : !live ? 'Paused' : data.sample.status === 'simulated' ? 'Simulated' : 'Live' }}</v-chip>
        {{ formatTimestamp(data.sample.collected_at) }} UTC
      </span>
    </div>
    <form
      class="connection-filters mb-3"
      aria-label="Connection filters"
      @submit.prevent="apply"
    >
      <div class="connection-toolbar">
        <v-text-field
          v-model="filters.address"
          label="IP address"
          prepend-inner-icon="mdi-magnify"
          autocomplete="off"
          density="compact"
          variant="outlined"
          hide-details
          class="connection-search"
        />
        <v-combobox
          v-model="filters.protocol"
          label="Protocol"
          :items="['tcp', 'udp', 'icmp', 'icmpv6', 'sctp'].filter(protocol => store.ipv6Enabled || protocol !== 'icmpv6')"
          clearable
          density="compact"
          variant="outlined"
          hide-details
          class="connection-protocol"
        />
        <v-select
          v-model="stateFilter"
          label="State"
          title="Filter states on the current page"
          :items="stateOptions"
          density="compact"
          variant="outlined"
          hide-details
          class="connection-state-filter"
        />
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
        <div class="connection-live">
          <v-btn
            icon="mdi-delete-sweep-outline"
            aria-label="Flush all connection states"
            title="Flush all connection states in the namespace, regardless of filters"
            variant="text"
            color="error"
            size="small"
            :disabled="deleting || deleteBlocked"
            @click="reviewDeletion(null)"
          />
          <v-switch
            v-model="live"
            label="Live"
            color="primary"
            hide-details
            density="compact"
          />
          <v-btn
            icon="mdi-refresh"
            aria-label="Refresh connections"
            title="Refresh connections"
            variant="text"
            size="small"
            :disabled="loading || !store.connected"
            :loading="loading"
            @click="refresh"
          />
        </div>
      </div>
      <div
        v-if="showFilters"
        class="connection-advanced"
      >
        <v-select
          v-if="store.ipv6Enabled"
          v-model="filters.family"
          label="Family"
          :items="[{ title: 'All', value: '' }, { title: 'IPv4', value: 'ipv4' }, { title: 'IPv6', value: 'ipv6' }]"
          density="compact"
          variant="outlined"
          hide-details
        />
        <v-text-field
          v-model="filters.port"
          label="Port"
          type="number"
          min="0"
          max="65535"
          density="compact"
          variant="outlined"
          hide-details
        />
        <v-text-field
          v-model="filters.zone"
          label="Zone"
          type="number"
          min="0"
          max="65535"
          density="compact"
          variant="outlined"
          hide-details
        />
        <v-select
          v-model="filters.limit"
          label="Page size"
          :items="[25, 50, 100, 250, 500, 1000]"
          density="compact"
          variant="outlined"
          hide-details
        />
      </div>
    </form>
    <v-alert
      v-if="filterError"
      type="error"
      role="alert"
      class="mb-3"
    >
      {{ filterError }}
    </v-alert>
    <v-alert
      v-if="error"
      type="error"
      role="alert"
      class="mb-3"
    >
      {{ stale ? 'Stale snapshot. ' : 'Unavailable. ' }}{{ error }}
    </v-alert>
    <v-alert
      v-if="deleteError && !deleteDialog"
      type="error"
      role="alert"
      class="mb-3"
    >
      {{ deleteError }}
    </v-alert>
    <v-alert
      v-if="deleteNotice"
      type="info"
      role="status"
      class="mb-3"
    >
      {{ deleteNotice }}
    </v-alert>
    <v-dialog
      v-model="deleteDialog"
      max-width="620"
      :persistent="deleting"
    >
      <v-card :title="selectedConnection ? 'Delete connection state?' : 'Flush ALL connection states?'">
        <v-card-text>
          <p
            v-if="selectedConnection"
            class="mono"
          >
            {{ selectedConnection.original.source }} to {{ selectedConnection.original.destination }} / {{ selectedConnection.family }} / {{ selectedConnection.protocol }} / zone {{ selectedConnection.zone }} / ID {{ selectedConnection.id }}
          </p>
          <p v-else>
            All IPv4 and IPv6 connection states in every zone of {{ selectedScope }} will be removed, including local and unmanaged traffic. Current filters and pagination do not limit this flush.
          </p>
          <p class="mt-3">
            Requires connections.delete. Management access and NAT sessions can be interrupted. This removes tracked state, does not send TCP resets, close sockets or block traffic. Entries can reappear immediately. There is no undo.
          </p>
          <v-alert
            v-if="deleteError"
            type="error"
            role="alert"
            class="mt-3"
          >
            {{ deleteError }}
          </v-alert>
        </v-card-text>
        <v-card-actions>
          <v-btn
            :disabled="deleting"
            @click="deleteDialog = false"
          >
            Cancel
          </v-btn>
          <v-btn
            color="error"
            :prepend-icon="selectedConnection ? 'mdi-delete-outline' : 'mdi-delete-sweep-outline'"
            :loading="deleting"
            :disabled="deleting || deleteBlocked"
            @click="removeConnections"
          >
            {{ selectedConnection ? 'Delete state' : 'Flush ALL states' }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <v-progress-linear
      v-if="loading"
      indeterminate
    />
    <template v-if="data">
      <v-table
        class="connections-table app-table"
        density="compact"
      >
        <thead>
          <tr>
            <th
              v-for="column in columns"
              :key="column.key"
              scope="col"
              :aria-sort="sortColumn === column.key ? (sortDescending ? 'descending' : 'ascending') : 'none'"
              :title="column.key.startsWith('sent_') ? 'Source to destination' : column.key.startsWith('received_') ? 'Destination to source' : undefined"
            >
              <button
                type="button"
                class="connection-sort"
                :title="`Sort current page by ${column.label.toLowerCase()} ${sortColumn === column.key && !sortDescending ? 'descending' : 'ascending'}`"
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
            v-for="row in sortedConnections"
            :key="key(row)"
          >
            <tr class="connection-row">
              <td class="connection-protocol-cell">
                <v-chip
                  size="small"
                  variant="tonal"
                  :color="protocolColor(row)"
                >
                  {{ row.protocol_name === 'other' ? `IP ${row.protocol}` : row.protocol_name.toUpperCase() }}
                </v-chip>
                <span class="connection-family">{{ row.family === 'ipv4' ? 'IPv4' : 'IPv6' }}</span>
              </td>
              <td
                class="endpoint"
                data-label="Source"
              >
                <div class="endpoint-value">
                  <span class="mono">{{ row.original.source }}</span>
                </div>
              </td>
              <td
                class="endpoint"
                data-label="Destination"
              >
                <div class="endpoint-value">
                  <span class="mono">{{ row.original.destination }}</span><v-chip
                    v-if="row.original.destination_port !== null"
                    size="x-small"
                    variant="tonal"
                    color="primary"
                    :title="`Destination port ${row.original.destination_port}`"
                  >
                    {{ row.original.destination_port }}
                  </v-chip>
                </div>
              </td>
              <td class="connection-state">
                <div class="state-chips">
                  <v-chip
                    size="small"
                    variant="tonal"
                    :color="stateColor(row.state)"
                  >
                    {{ row.state }}
                  </v-chip><v-chip
                    v-if="row.source_nat"
                    size="x-small"
                    color="secondary"
                    variant="tonal"
                  >
                    SNAT
                  </v-chip><v-chip
                    v-if="row.destination_nat"
                    size="x-small"
                    color="secondary"
                    variant="tonal"
                  >
                    DNAT
                  </v-chip>
                  <v-btn
                    icon="mdi-delete-outline"
                    :aria-label="`Delete connection ${row.id ?? 'without identity'}`"
                    :title="connectionSelector(row) ? 'Delete this connection state' : 'Deletion unavailable: unsupported or incomplete identity'"
                    variant="text"
                    size="x-small"
                    color="error"
                    :disabled="deleting || deleteBlocked || !connectionSelector(row)"
                    @click="reviewDeletion(row)"
                  />
                </div>
              </td>
              <td
                class="connection-number"
                data-label="Sent packets"
                :title="row.original_counters ? `${row.original_counters.packets} packets` : undefined"
              >
                {{ row.original_counters?.packets ?? 'Unavailable' }}
              </td>
              <td
                class="connection-number"
                data-label="Received packets"
                :title="row.reply_counters ? `${row.reply_counters.packets} packets` : undefined"
              >
                {{ row.reply_counters?.packets ?? 'Unavailable' }}
              </td>
              <td
                class="connection-number connection-bytes"
                data-label="Sent bytes"
                :title="row.original_counters ? `${row.original_counters.bytes} bytes` : undefined"
              >
                {{ row.original_counters ? bytes(row.original_counters.bytes) : 'Unavailable' }}
              </td>
              <td
                class="connection-number connection-bytes"
                data-label="Received bytes"
                :title="row.reply_counters ? `${row.reply_counters.bytes} bytes` : undefined"
              >
                {{ row.reply_counters ? bytes(row.reply_counters.bytes) : 'Unavailable' }}
              </td>
              <td
                class="connection-timeout"
                data-label="Timeout"
              >
                <v-icon
                  icon="mdi-timer-outline"
                  size="14"
                  class="mr-1"
                />{{ row.timeout_seconds === null ? 'Unavailable' : `${row.timeout_seconds}s` }}
              </td>
            </tr>
          </template>
          <tr v-if="!sortedConnections.length">
            <td :colspan="columns.length">
              {{ data.sample.status === 'simulated' ? 'Simulated; no measured connections.' : stateFilter ? `No ${stateFilter} connections on this page.` : 'No connections match these filters.' }}
            </td>
          </tr>
        </tbody>
      </v-table>
      <div class="connection-footer">
        <span class="text-caption text-medium-emphasis">{{ sortedConnections.length }} shown · {{ data.summary.matched ?? 'Unavailable' }} {{ stateFilter ? 'server matched' : 'matched' }} <span v-if="data.summary.accounting_unavailable">· Accounting unavailable: {{ data.summary.accounting_unavailable }}</span></span>
        <span class="text-caption connection-offset">Offset {{ data.offset }}</span>
        <v-btn
          icon="mdi-chevron-left"
          title="Previous connections page"
          aria-label="Previous connections page"
          variant="text"
          :disabled="loading || data.offset === 0"
          @click="page(previousOffset)"
        />
        <v-btn
          icon="mdi-chevron-right"
          title="Next connections page"
          aria-label="Next connections page"
          variant="text"
          :disabled="loading || data.next_offset === null"
          @click="page(data.next_offset!)"
        />
      </div>
    </template>
  </section>
</template>

<style scoped>
.connections-page { min-width: 0; }
.connection-heading { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-bottom: 16px; }
.connection-sample { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-left: auto; color: var(--text-secondary); }
.connection-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.connection-search { flex: 1 1 220px; max-width: 360px; min-width: 0; }
.connection-protocol { flex: 0 1 150px; min-width: 130px; }
.connection-state-filter { flex: 0 1 180px; min-width: 150px; }
.connection-live { display: flex; align-items: center; gap: 12px; margin-left: auto; }
.connection-advanced { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-top: 12px; max-width: 720px; }
.connections-table { background: #090c10; border: 1px solid var(--border); border-radius: 6px; }
.connections-table :deep(.v-table__wrapper > table > thead > tr > th), .connections-table :deep(.v-table__wrapper > table > tbody > tr > td) { padding: 0 8px; }
.connections-table :deep(th) { white-space: nowrap; color: var(--text-secondary); font-size: 12px; font-weight: 600; }
.connection-sort { display: inline-flex; align-items: center; gap: 4px; min-height: 40px; color: inherit; font: inherit; cursor: pointer; }
.connection-sort:hover, .connections-table :deep(th[aria-sort="ascending"]), .connections-table :deep(th[aria-sort="descending"]) { color: var(--text-primary); }
.connection-sort:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 2px; }
.connections-table :deep(td) { height: 56px; vertical-align: middle; }
.connection-row:hover { background: var(--bg-hover); }
.connection-protocol-cell { min-width: 88px; }
.connection-family { display: block; color: var(--text-muted); font-size: 11px; line-height: 16px; padding-left: 8px; }
.endpoint { min-width: 140px; max-width: 280px; }
.endpoint-value { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; min-width: 0; max-width: 100%; }
.endpoint-value .mono { font-size: 13px; overflow-wrap: anywhere; white-space: normal; min-width: 0; max-width: 100%; }
.connection-state { white-space: nowrap; }
.state-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.connection-number { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; font-size: 13px; }
.connection-timeout { min-width: 110px; white-space: nowrap; color: var(--text-secondary); font-size: 13px; }
.connection-footer { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 0; }
.connection-offset { margin-left: auto; }
@media (max-width: 600px) {
  .connection-sample { margin-left: 0; flex-basis: 100%; }
  .connection-search { flex-basis: 100%; max-width: none; }
  .connection-advanced { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .connection-live { gap: 4px; }
  .connections-table :deep(table), .connections-table :deep(tbody) { display: block; width: 100%; }
  .connections-table :deep(thead) { display: block; overflow-x: auto; }
  .connections-table :deep(thead tr) { display: flex; }
  .connections-table :deep(th) { flex-shrink: 0; }
  .connection-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px 12px; padding: 12px; position: relative; border-bottom: 1px solid var(--border); }
  .connections-table :deep(.v-table__wrapper > table > tbody > .connection-row > td) { height: auto; min-width: 0; max-width: none; padding: 0; border: 0; }
  .connection-protocol-cell { grid-column: 1; grid-row: 1; display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }
  .connection-family { padding: 0; }
  .connection-row > .connection-state { grid-column: 2 / -1; grid-row: 1; justify-self: end; }
  .state-chips { flex-wrap: wrap; justify-content: end; }
  .connection-row > .endpoint { grid-column: 1 / -1; display: grid; grid-template-columns: 72px minmax(0, 1fr); align-items: start; gap: 8px; }
  .connection-row > .connection-number { grid-column: 1 / -1; display: flex; justify-content: space-between; gap: 8px; }
  .connection-timeout { grid-column: 1 / -1; text-align: right; }
  .endpoint::before, .connection-number::before, .connection-timeout::before { content: attr(data-label); color: var(--text-muted); font-size: 11px; }
  .connection-timeout::before { margin-right: 8px; }
  .connection-footer > span:first-child { flex-basis: 100%; }
  .connection-footer { padding-inline-end: 72px; }
  .connection-offset { margin-left: 0; margin-right: auto; }
}
</style>