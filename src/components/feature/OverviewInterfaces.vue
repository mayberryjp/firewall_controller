<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { useControllerStore } from "@/stores/controller";
import { getDiscoveredInterfaces } from "@/services/netcontrol";
import { isInitialLoad } from "@/services/datasets";
import { isSystemLoopback } from "@/services/resourceCollections";
import type { DiscoveredInterface } from "@/types/domain";
import OverviewWidget from "./OverviewWidget.vue";
import OverviewInterfaceStatus from "./OverviewInterfaceStatus.vue";
import OverviewInterfaceIdentity from "./OverviewInterfaceIdentity.vue";
const store = useControllerStore();
const interfaceStates = ["admin", "operational"] as const;
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
])].map(name => {
  const link = discovered.value.find(item => item.name === name);
  return {
    name, sample: store.statistics.data?.interfaces.find(item => item.name === name),
    addresses: link?.addresses.filter(address => store.ipv6Enabled || !address.includes(":")),
    loopback: isSystemLoopback(link),
    mode: isSystemLoopback(link) ? link?.addressing_type === "static" ? "Static" : "—" :
      store.state.data?.desired.dhcp_clients?.[name] ? "DHCP" : store.state.data?.desired.interfaces.some(item => item.name === name) ? "Static" : "-",
  };
}));
const note = computed(() => store.statistics.error ? "Unavailable" : isInitialLoad(store.statistics) ? "" : store.statistics.stale ? "Stale" : store.statistics.data?.sample.status === "simulated" ? "Simulated" : "");
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
      <colgroup><col style="width: 30%"><col style="width: 15%"><col style="width: 18%"><col style="width: 24%"><col style="width: 13%"></colgroup>
      <thead>
        <tr>
          <th title="Name">
            Name
          </th><th title="Admin state">
            Admin state
          </th><th title="Operational state">
            Operational state
          </th><th title="Active IP">
            Active IP
          </th><th title="Mode">
            Mode
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.name"
        >
          <td>
            <OverviewInterfaceIdentity
              :name="row.name"
              :loopback="row.loopback"
            />
          </td>
          <td
            v-for="state in interfaceStates"
            :key="state"
          >
            <OverviewInterfaceStatus
              :state="state"
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
                class="interface-address"
                :title="address"
              >
                {{ address }}
              </div>
            </template>
            <template v-else>
              {{ row.addresses ? "None" : addressError ? "Unavailable" : "—" }}
            </template>
          </td>
          <td>{{ row.mode }}</td>
        </tr>
        <tr v-if="!rows.length && !isInitialLoad(store.statistics) && !isInitialLoad(store.state)">
          <td colspan="5">
            {{ store.statistics.data ? "No interfaces." : "Interface status unavailable." }}
          </td>
        </tr>
      </tbody>
    </v-table>
  </OverviewWidget>
</template>

<style scoped>
.overview-interfaces :deep(table) { width: 100%; table-layout: fixed; }
.overview-interfaces :deep(table th), .overview-interfaces :deep(table td) { padding: 2px 6px !important; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.overview-interfaces :deep(table th) { font-size: 12px; }
.interface-address { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 14px; }
.overview-interfaces :deep(.v-chip) { max-width: 100%; }
.overview-interfaces :deep(.v-chip__content) { display: block; overflow: hidden; text-overflow: ellipsis; }
</style>