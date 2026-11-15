<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useControllerStore } from "@/stores/controller";
import { useDiagnosticRead } from "@/composables/useDiagnosticRead";
import { useTimestamps } from "@/composables/useTimestamps";
import { getRouteTable, type RouteTableRow } from "@/services/routeTable";
import { formatInterfaceName } from "@/services/interfaceNames";

const store = useControllerStore();
const { formatTimestamp, timeZone } = useTimestamps();
const { data, loading, error, stale, read } = useDiagnosticRead(getRouteTable, 30000);
const search = ref<string | null>(""), family = ref<"ipv4" | "ipv6" | null>(null);
const protocol = ref<number | null>(null), type = ref<number | null>(null);
const device = ref<string | null>(null), page = ref(0);
const pageSize = 100;
const tables: Record<number, string> = { 0: "Unspecified", 253: "Default", 254: "Main", 255: "Local" };
const protocols: Record<number, string> = {
  0: "Unspecified", 1: "Redirect", 2: "Kernel", 3: "Boot", 4: "Static", 8: "Gated", 9: "RA",
  11: "Zebra", 12: "BIRD", 16: "DHCP", 42: "Babel", 186: "BGP", 187: "IS-IS", 188: "OSPF", 189: "RIP",
};
const types: Record<number, string> = {
  0: "Unspecified", 1: "Unicast", 2: "Local", 3: "Broadcast", 4: "Anycast", 5: "Multicast",
  6: "Blackhole", 7: "Unreachable", 8: "Prohibit", 9: "Throw", 10: "NAT", 11: "Xresolve",
};
const identifier = (value: number, names: Record<number, string>, fallback: string) =>
  names[value] ? `${names[value]} (${value})` : `${fallback} ${value}`;
const tableLabel = (value: number) => identifier(value, tables, "Table");
const protocolLabel = (value: number) => identifier(value, protocols, "Protocol");
const typeLabel = (value: number) => identifier(value, types, "Type");
const linkLabel = (name: string | null, index: number | null) =>
  name !== null ? `${formatInterfaceName(name)}${index === null ? "" : ` (#${index})`}` :
    index === null ? "No device" : `Index ${index}`;
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
function links(row: RouteTableRow) {
  const entries = row.next_hops.length && row.interface === null && row.interface_index === null ? [] :
    [{ interface: row.interface, interface_index: row.interface_index }];
  const unique = new Map<string, { value: string; title: string }>();
  for (const link of [...entries, ...row.next_hops]) {
    const value = link.interface_index === null ? `name:${link.interface ?? ""}` : `index:${link.interface_index}`;
    unique.set(value, { value, title: linkLabel(link.interface, link.interface_index) });
  }
  return [...unique.values()];
}
const rows = computed(() => (data.value?.routes ?? []).filter(route => route.table === 254)
  .map((route, index) => ({ route, index, links: links(route) })));
function choices(key: "protocol" | "type", label: (value: number) => string) {
  return [...new Set(rows.value.map(row => row.route[key]))].sort((a, b) => a - b).map(value => ({ value, title: label(value) }));
}
const protocolChoices = computed(() => choices("protocol", protocolLabel));
const typeChoices = computed(() => choices("type", typeLabel));
const deviceChoices = computed(() => [...new Map(rows.value.flatMap(row => row.links).map(link => [link.value, link])).values()]
  .sort((a, b) => collator.compare(a.title, b.title)));
const families = computed(() => [
  { value: null, title: "All routes", count: rows.value.length },
  { value: "ipv4" as const, title: "IPv4", count: rows.value.filter(row => row.route.family === "ipv4").length },
  { value: "ipv6" as const, title: "IPv6", count: rows.value.filter(row => row.route.family === "ipv6").length },
]);
const columns = [
  { key: "destination", title: "Destination" }, { key: "source_prefix", title: "Source prefix" },
  { key: "gateway", title: "Gateway" }, { key: "interface", title: "Interface" },
  { key: "table", title: "Table" },
  { key: "type", title: "Type" }, { key: "metric", title: "Metric" },
] as const;
type Column = typeof columns[number]["key"];
const sortColumn = ref<Column>("destination"), descending = ref(false);
function sort(column: Column) {
  descending.value = column === sortColumn.value ? !descending.value : false;
  sortColumn.value = column;
}
const filtered = computed(() => {
  const terms = (search.value ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  return rows.value.filter(({ route, links: routeLinks }) => {
    if (family.value !== null && route.family !== family.value ||
      protocol.value !== null && route.protocol !== protocol.value ||
      type.value !== null && route.type !== type.value ||
      device.value !== null && !routeLinks.some(link => link.value === device.value)) return false;
    const text = [
      route.family, route.destination, route.source_prefix, route.gateway, route.preferred_source, route.metric,
      tableLabel(route.table), protocolLabel(route.protocol), typeLabel(route.type),
      ...routeLinks.map(link => link.title), ...route.next_hops.map(hop => hop.gateway),
    ].join(" ").toLowerCase();
    return terms.every(term => text.includes(term));
  }).sort((a, b) => {
    const left = sortColumn.value === "interface" ? a.links.map(link => link.title).join(" ") : a.route[sortColumn.value];
    const right = sortColumn.value === "interface" ? b.links.map(link => link.title).join(" ") : b.route[sortColumn.value];
    if (left === null || right === null) return left === right ? a.index - b.index : left === null ? 1 : -1;
    const result = typeof left === "number" && typeof right === "number" ? left - right : collator.compare(String(left), String(right));
    return (descending.value ? -result : result) || a.index - b.index;
  });
});
const visibleRows = computed(() => filtered.value.slice(page.value * pageSize, (page.value + 1) * pageSize));
watch([search, family, protocol, type, device, sortColumn, descending], () => { page.value = 0; });
watch(data, () => {
  page.value = Math.min(page.value, Math.max(0, Math.ceil(filtered.value.length / pageSize) - 1));
});
function clearFilters() {
  search.value = ""; family.value = null; protocol.value = null; type.value = null; device.value = null;
}
</script>

<template>
  <section
    class="live-routes"
    aria-label="Routing table"
  >
    <header class="live-routes-header">
      <div>
        <h2 class="text-h6">
          Routing table
        </h2>
        <p class="text-body-2 text-medium-emphasis">
          Main routing table (254). Read-only.
        </p>
      </div>
      <v-btn
        prepend-icon="mdi-refresh"
        :loading="loading"
        :disabled="!store.connected || loading"
        @click="read"
      >
        Refresh
      </v-btn>
    </header>
    <p
      v-if="!store.connected"
      role="status"
    >
      Connect a firewall to read its live routes.
    </p>
    <p
      v-else-if="loading && !data"
      role="status"
    >
      Loading routing table...
    </p>
    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      role="alert"
      class="mb-3"
    >
      {{ error }}
    </v-alert>
    <p
      v-if="stale"
      role="status"
      class="text-warning mb-3"
    >
      Stale: last-known routes retained after the failed refresh.
    </p>
    <template v-if="data">
      <div class="route-summary">
        <div
          class="family-filters"
          aria-label="Address family"
        >
          <v-chip
            v-for="item in families"
            :key="item.title"
            :color="family === item.value ? 'primary' : undefined"
            :variant="family === item.value ? 'flat' : 'tonal'"
            :aria-pressed="family === item.value"
            tag="button"
            type="button"
            @click="family = item.value"
          >
            {{ item.title }} <span class="family-count">{{ item.count.toLocaleString() }}</span>
          </v-chip>
        </div>
        <p class="text-caption text-medium-emphasis">
          Observed ({{ timeZone }}): <time :datetime="new Date(data.collected_at_unix_ms).toISOString()">{{ formatTimestamp(data.collected_at_unix_ms) }}</time>
        </p>
      </div>
      <div class="route-filters">
        <v-text-field
          v-model="search"
          label="Search routes"
          prepend-inner-icon="mdi-magnify"
          clearable
          density="compact"
          hide-details
          @click:clear="search = ''"
        />
        <v-select
          v-model="protocol"
          :items="protocolChoices"
          label="Protocol"
          clearable
          density="compact"
          hide-details
        />
        <v-select
          v-model="type"
          :items="typeChoices"
          label="Type"
          clearable
          density="compact"
          hide-details
        />
        <v-select
          v-model="device"
          :items="deviceChoices"
          label="Interface"
          clearable
          density="compact"
          hide-details
        />
      </div>
      <div class="route-table-scroll">
        <table class="live-route-table">
          <thead>
            <tr>
              <th
                v-for="column in columns"
                :key="column.key"
                scope="col"
                :aria-sort="sortColumn === column.key ? descending ? 'descending' : 'ascending' : 'none'"
              >
                <button
                  class="sort-header"
                  type="button"
                  @click="sort(column.key)"
                >
                  {{ column.title }}
                  <v-icon
                    v-if="sortColumn === column.key"
                    :icon="descending ? 'mdi-arrow-down' : 'mdi-arrow-up'"
                    size="14"
                  />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in visibleRows"
              :key="item.index"
              class="route-row"
            >
              <td>
                <div class="destination-cell">
                  <v-chip
                    size="x-small"
                    :color="item.route.family === 'ipv4' ? 'info' : 'secondary'"
                    variant="tonal"
                  >
                    {{ item.route.family === 'ipv4' ? 'IPv4' : 'IPv6' }}
                  </v-chip>
                  <code>{{ item.route.destination }}</code>
                  <v-chip
                    v-if="item.route.destination.endsWith('/0')"
                    size="x-small"
                    color="primary"
                    variant="outlined"
                  >
                    Default
                  </v-chip>
                </div>
              </td>
              <td><code>{{ item.route.source_prefix }}</code></td>
              <td>
                <code v-if="item.route.gateway !== null">{{ item.route.gateway }}</code>
                <v-chip
                  v-else-if="item.route.next_hops.length"
                  size="small"
                  color="info"
                  variant="tonal"
                >
                  {{ item.route.next_hops.length }} next hops
                </v-chip>
                <span v-else-if="item.route.nexthop_id !== null">Object #{{ item.route.nexthop_id }}</span>
                <span
                  v-else
                  class="text-medium-emphasis"
                >No gateway</span>
              </td>
              <td>
                <div class="interface-chips">
                  <v-chip
                    v-for="link in item.links"
                    :key="link.value"
                    size="small"
                    variant="tonal"
                    prepend-icon="mdi-ethernet"
                  >
                    {{ link.title }}
                  </v-chip>
                </div>
              </td>
              <td>
                <v-chip
                  size="small"
                  :color="item.route.table === 254 ? 'primary' : item.route.table === 255 ? undefined : 'secondary'"
                  variant="tonal"
                >
                  {{ tableLabel(item.route.table) }}
                </v-chip>
              </td>
              <td>
                <v-chip
                  size="small"
                  :color="[6, 7, 8].includes(item.route.type) ? 'warning' : undefined"
                  variant="tonal"
                >
                  {{ typeLabel(item.route.type) }}
                </v-chip>
              </td>
              <td class="metric-cell">
                {{ item.route.metric ?? "Not specified" }}
              </td>
            </tr>
            <tr v-if="!filtered.length">
              <td
                :colspan="columns.length"
                class="empty-routes"
              >
                <p>{{ rows.length ? "No routes match these filters." : "No main-table routes were returned." }}</p>
                <v-btn
                  v-if="rows.length"
                  variant="text"
                  size="small"
                  @click="clearFilters"
                >
                  Clear filters
                </v-btn>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <footer class="route-footer">
        <p class="text-caption text-medium-emphasis">
          {{ filtered.length ? (page * pageSize + 1).toLocaleString() : 0 }}-{{ Math.min((page + 1) * pageSize, filtered.length).toLocaleString() }}
          of {{ filtered.length.toLocaleString() }} routes<span v-if="filtered.length !== rows.length"> ({{ rows.length.toLocaleString() }} total)</span>
        </p>
        <div
          v-if="filtered.length > pageSize"
          class="route-pagination"
        >
          <v-btn
            icon="mdi-chevron-left"
            variant="text"
            size="small"
            aria-label="Previous routes"
            :disabled="page === 0"
            @click="page--"
          />
          <v-btn
            icon="mdi-chevron-right"
            variant="text"
            size="small"
            aria-label="Next routes"
            :disabled="(page + 1) * pageSize >= filtered.length"
            @click="page++"
          />
        </div>
      </footer>
    </template>
  </section>
</template>

<style scoped>
.live-routes { min-width: 0; }
.live-routes-header, .route-summary, .route-footer { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
.live-routes-header { margin-bottom: 1.25rem; }
.route-summary { margin-bottom: 1rem; }
.family-filters, .destination-cell, .interface-chips, .route-pagination { display: flex; align-items: center; gap: .45rem; }
.family-filters, .interface-chips { flex-wrap: wrap; }
.family-count { margin-left: .5rem; opacity: .8; font-variant-numeric: tabular-nums; }
.route-filters { display: grid; grid-template-columns: minmax(220px, 2fr) repeat(3, minmax(130px, 1fr)); gap: .75rem; margin-bottom: 1rem; }
.route-table-scroll { max-width: 100%; overflow-x: auto; }
.live-route-table { width: 100%; border-collapse: collapse; font-size: .8125rem; white-space: nowrap; }
.live-route-table th, .live-route-table td { text-align: left; padding: .8rem .7rem; border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); }
.live-route-table th { background: rgba(var(--v-theme-on-surface), .035); color: rgb(var(--v-theme-on-surface-variant)); }
.live-route-table tbody > tr:last-child > td { border-bottom: 0; }
.route-row:hover { background: rgba(var(--v-theme-primary), .045); }
.sort-header { display: inline-flex; align-items: center; gap: .35rem; font: inherit; font-weight: 600; color: inherit; }
.sort-header:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 4px; }
.interface-chips { min-width: 110px; max-width: 260px; }
.metric-cell, code { font-variant-numeric: tabular-nums; }
.empty-routes { text-align: center !important; padding: 2.5rem !important; }
.route-footer { margin-top: .75rem; }
@media (max-width: 1100px) { .route-filters { grid-template-columns: repeat(2, minmax(0, 1fr)); } .route-filters > :first-child { grid-column: 1 / -1; } }
</style>
