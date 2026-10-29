<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useControllerStore } from "@/stores/controller";
import DatasetStatus from "@/components/base/DatasetStatus.vue";

const store = useControllerStore();
const direction = ref<"received" | "advertised">("received"), neighbor = ref<string | null>(null);
watch([direction, () => store.connected, () => store.sessionVersion], () => {
  store.bgpRouteDirection = direction.value;
  if (store.connected && document.visibilityState !== "hidden") {
    if (direction.value === "advertised") void store.refreshBGPAdvertisedRoutes();
    else void store.refreshBGPRoutes();
  }
}, { immediate: true });
watch(direction, () => { neighbor.value = null; });
const query = computed(() => direction.value === "advertised" ? store.bgpAdvertisedRoutes : store.bgpRoutes);
const neighbors = computed(() => [...new Set(query.value.data?.routes.map(route => route.neighbor) ?? [])].sort());
const received = computed(() => (store.bgpRoutes.data?.routes ?? []).filter(route => !neighbor.value || route.neighbor === neighbor.value));
const advertised = computed(() => store.bgpAdvertisedRoutesCurrent
  ? (store.bgpAdvertisedRoutes.data?.routes ?? []).filter(route => !neighbor.value || route.neighbor === neighbor.value) : []);
const advertisedEmpty = computed(() => {
  if (query.value.loading && !query.value.data) return "Loading advertised BGP routes...";
  if (!query.value.data || query.value.stale || query.value.error || query.value.data.error ||
    (query.value.data.state === "running" && !store.bgpAdvertisedRoutesCurrent)) return "Advertised BGP routes unavailable.";
  return neighbor.value ? "No advertised BGP routes for this neighbor." : "No advertised BGP routes.";
});
</script>

<template>
  <section aria-label="BGP routes">
    <div class="route-toolbar mb-3">
      <v-tabs
        v-model="direction"
        color="primary"
        aria-label="BGP route direction"
      >
        <v-tab value="received">
          Received
        </v-tab>
        <v-tab value="advertised">
          Advertised
        </v-tab>
      </v-tabs>
      <v-select
        v-model="neighbor"
        :items="neighbors"
        label="Neighbor"
        clearable
        density="compact"
        hide-details
        class="neighbor-filter"
      />
    </div>
    <DatasetStatus
      :query="query"
      :label="direction === 'advertised' ? 'Advertised BGP routes' : 'Received BGP routes'"
    />
    <p
      v-if="query.data?.error"
      role="alert"
      class="text-error mb-3"
    >
      {{ query.data.error }}
    </p>
    <v-table
      v-if="direction === 'advertised'"
      density="compact"
      class="inline-table advertised-table"
    >
      <caption class="route-caption">
        Advertised BGP routes
      </caption>
      <thead><tr><th>Prefix</th><th>Peer</th><th>Interface</th><th>Next hop</th></tr></thead>
      <tbody>
        <tr
          v-for="route in advertised"
          :key="`${route.neighbor}/${route.prefix}`"
        >
          <td data-label="Prefix">
            {{ route.prefix }}
          </td>
          <td data-label="Peer">
            {{ route.neighbor }}
          </td>
          <td data-label="Interface">
            {{ route.interface }}
          </td>
          <td data-label="Next hop">
            {{ route.next_hop }}
          </td>
        </tr>
        <tr v-if="!advertised.length">
          <td colspan="4">
            {{ advertisedEmpty }}
          </td>
        </tr>
      </tbody>
    </v-table>
    <template v-else>
      <v-table
        density="compact"
        class="inline-table"
      >
        <thead><tr><th>Prefix</th><th>Peer</th><th>Interface</th><th>Next hop</th><th>AS path</th><th>Selected</th><th>Installed</th></tr></thead>
        <tbody>
          <tr
            v-for="(route, index) in received"
            :key="`${route.prefix}/${route.neighbor}/${index}`"
          >
            <td>{{ route.prefix }}</td><td>{{ route.neighbor }}</td><td>{{ route.interface }}</td><td>{{ route.next_hop }}</td><td>{{ route.as_path.join(' ') || 'None' }}</td>
            <td>
              <v-chip
                size="small"
                variant="tonal"
                :color="store.bgpRoutesCurrent && route.selected ? 'success' : 'default'"
              >
                {{ store.bgpRoutesCurrent ? route.selected ? 'Yes' : 'No' : 'Unknown' }}
              </v-chip>
            </td>
            <td>
              <v-chip
                size="small"
                variant="tonal"
                :color="!store.bgpRoutesCurrent ? 'default' : route.installed ? 'success' : route.selected ? 'warning' : 'default'"
              >
                {{ store.bgpRoutesCurrent ? route.installed ? 'Yes' : 'No' : 'Unknown' }}
              </v-chip>
            </td>
          </tr>
          <tr v-if="!received.length">
            <td colspan="7">
              {{ store.bgpRoutes.loading && !store.bgpRoutes.data ? 'Loading received BGP routes...' : store.bgpRoutes.data ? neighbor ? 'No learned BGP routes for this neighbor.' : 'No learned BGP routes.' : 'BGP routes unavailable.' }}
            </td>
          </tr>
        </tbody>
      </v-table>
    </template>
  </section>
</template>

<style scoped>
.route-toolbar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
.neighbor-filter { flex: 0 1 240px; min-width: 180px; }
.route-caption { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.inline-table :deep(th), .inline-table :deep(td) { padding: 2px 6px; }
@media (max-width: 600px) {
  .advertised-table :deep(thead) { display: none; }
  .advertised-table :deep(table), .advertised-table :deep(tbody), .advertised-table :deep(tr) { display: block; width: 100%; }
  .advertised-table :deep(tr) { padding-block: 8px; }
  .advertised-table :deep(td) { display: block; height: auto !important; }
  .advertised-table :deep(td[data-label]) { display: grid; grid-template-columns: 80px minmax(0, 1fr); gap: 12px; min-height: 32px; align-items: center; }
  .advertised-table :deep(td[data-label]::before) { content: attr(data-label); font-size: 0.75rem; color: var(--text-muted); }
}
</style>