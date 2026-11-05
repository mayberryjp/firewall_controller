<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import { useControllerStore } from "@/stores/controller";
import { bgpPeerStatus } from "@/services/bgp";
import { isInitialLoad } from "@/services/datasets";
import OverviewWidget from "./OverviewWidget.vue";
const store = useControllerStore();
const config = computed(() => (store.state.data?.active_transaction?.candidate ?? store.state.data?.desired)?.bgp);
const rows = computed(() => config.value?.neighbors.map(peer => ({
  ...peer, status: bgpPeerStatus(peer, config.value?.enabled === true, store.bgpStatus.data, store.bgpStatusCurrent),
})) ?? []);
onMounted(() => { store.bgpMonitoring = true; if (store.connected) void store.refreshBGPStatus(); });
onUnmounted(() => { store.bgpMonitoring = false; });
</script>
<template>
  <OverviewWidget
    title="BGP peers"
    to="/routing/bgp"
    :note="store.bgpStatus.error || store.bgpStatus.data?.error ? 'Unavailable' : store.bgpStatus.data && !store.bgpStatusCurrent ? 'Stale' : undefined"
    :detail="store.bgpStatus.error ?? store.bgpStatus.data?.error ?? undefined"
  >
    <v-table
      class="bgp-peer-table"
      density="compact"
    >
      <thead><tr><th>Peer</th><th>Address</th><th>Status</th></tr></thead>
      <tbody>
        <tr
          v-for="peer in rows"
          :key="peer.name"
        >
          <td>{{ peer.metadata?.display_name || peer.name }}</td><td>{{ peer.address }}</td>
          <td>
            <v-chip
              size="small"
              variant="tonal"
              :color="peer.status.color"
              :title="peer.status.observation?.error ?? undefined"
            >
              {{ peer.status.label }}
            </v-chip>
          </td>
        </tr>
        <tr v-if="!rows.length && !isInitialLoad(store.state)">
          <td colspan="3">
            {{ store.state.data ? 'No BGP peers.' : 'BGP status unavailable.' }}
          </td>
        </tr>
      </tbody>
    </v-table>
  </OverviewWidget>
</template>

<style scoped>
.bgp-peer-table :deep(table) { width: 100%; }
.bgp-peer-table :deep(th),
.bgp-peer-table :deep(td:not([colspan])) { width: calc(100% / 3); }
.bgp-peer-table :deep(th:nth-child(2)),
.bgp-peer-table :deep(td:nth-child(2)) { text-align: center; }
.bgp-peer-table :deep(th:last-child),
.bgp-peer-table :deep(td:last-child:not([colspan])) { text-align: right; }
</style>
