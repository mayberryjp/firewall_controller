<script setup lang="ts">
import { computed } from "vue";
import { useControllerStore } from "@/stores/controller";
import OverviewWidget from "./OverviewWidget.vue";
import OverviewInterfaceStatus from "./OverviewInterfaceStatus.vue";
const store = useControllerStore();
const tunnels = computed(() => (store.state.data?.active_transaction?.candidate ?? store.state.data?.desired)?.interfaces.filter(item => item.kind === "wireguard") ?? []);
</script>

<template>
  <OverviewWidget
    title="WireGuard"
    to="/wireguard"
    :note="store.state.stale ? 'Stale' : undefined"
  >
    <v-table density="compact">
      <thead><tr><th>Tunnel</th><th>Link status</th><th>Configured peers</th><th>Listen port</th></tr></thead>
      <tbody>
        <tr
          v-for="tunnel in tunnels"
          :key="tunnel.name"
        >
          <td>{{ tunnel.name }}</td>
          <td>
            <OverviewInterfaceStatus
              :sample="store.statistics.data?.interfaces.find(item => item.name === tunnel.name)"
              :stale="store.statistics.stale || Boolean(store.statistics.error)"
              :simulated="store.statistics.data?.sample.status === 'simulated'"
            />
          </td>
          <td>{{ tunnel.wireguard.peers.length }}</td>
          <td>{{ tunnel.wireguard.listen_port }}</td>
        </tr>
        <tr v-if="!tunnels.length">
          <td colspan="4">
            {{ store.state.data ? "No WireGuard tunnels." : "WireGuard configuration unavailable." }}
          </td>
        </tr>
      </tbody>
    </v-table>
  </OverviewWidget>
</template>