<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { useControllerStore } from "@/stores/controller";
import { getDiscoveredInterfaces } from "@/services/netcontrol";
import type { DiscoveredInterface } from "@/types/domain";
import OverviewWidget from "./OverviewWidget.vue";
import OverviewInterfaceStatus from "./OverviewInterfaceStatus.vue";
const store = useControllerStore();
const discovered = ref<DiscoveredInterface[]>([]), addressError = ref("");
let controller: AbortController | undefined;
async function refreshAddresses() {
  if (controller) return;
  const request = new AbortController();
  controller = request;
  try { discovered.value = await getDiscoveredInterfaces(request.signal); addressError.value = ""; }
  catch (error) { if (!request.signal.aborted) addressError.value = error instanceof Error ? error.message : "Active addresses unavailable"; }
  finally { controller = undefined; }
}
watch(() => store.statistics.data, refreshAddresses, { immediate: true });
onUnmounted(() => controller?.abort());
const rows = computed(() => [...new Set([
  ...(store.statistics.data?.interfaces.map(item => item.name) ?? []),
  ...(store.state.data?.desired.interfaces.map(item => item.name) ?? []),
  ...discovered.value.map(item => item.name),
])].map(name => ({
  name, sample: store.statistics.data?.interfaces.find(item => item.name === name),
  addresses: discovered.value.find(item => item.name === name)?.addresses.filter(address => store.ipv6Enabled || !address.includes(":")),
  mode: store.state.data?.desired.dhcp_clients?.[name] ? "DHCP" : store.state.data?.desired.interfaces.some(item => item.name === name) ? "Static" : "Unknown",
})));
const note = computed(() => store.statistics.error ? "Unavailable" : store.statistics.loading && !store.statistics.data ? "Loading" : store.statistics.stale ? "Stale" : store.statistics.data?.sample.status === "simulated" ? "Simulated" : "");
</script>

<template>
  <OverviewWidget
    title="Interfaces"
    to="/interfaces"
    :note="note"
    :detail="store.statistics.error ?? undefined"
  >
    <v-table
      density="compact"
      class="overview-interfaces"
    >
      <thead><tr><th>Name</th><th>Status</th><th>Active IP</th><th>Mode</th></tr></thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.name"
        >
          <td>{{ row.name }}</td>
          <td>
            <OverviewInterfaceStatus
              :sample="row.sample"
              :stale="store.statistics.stale || Boolean(store.statistics.error)"
              :simulated="store.statistics.data?.sample.status === 'simulated'"
            />
          </td>
          <td :title="addressError ? `Last known addresses: ${addressError}` : undefined">
            <template v-if="row.addresses?.length">
              <div
                v-for="address in row.addresses"
                :key="address"
              >
                {{ address }}
              </div>
            </template>
            <template v-else>
              {{ row.addresses ? "None" : "Unavailable" }}
            </template>
          </td>
          <td>{{ row.mode }}</td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="4">
            {{ store.statistics.data ? "No interfaces." : "Interface status unavailable." }}
          </td>
        </tr>
      </tbody>
    </v-table>
  </OverviewWidget>
</template>

<style scoped>
.overview-interfaces :deep(th), .overview-interfaces :deep(td) { padding: 0 8px; }
.overview-interfaces :deep(td) { overflow-wrap: anywhere; white-space: normal; }
</style>