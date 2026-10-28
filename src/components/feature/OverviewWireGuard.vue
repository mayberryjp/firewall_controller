<script setup lang="ts">
import { computed } from "vue";
import { useControllerStore } from "@/stores/controller";
import { formatBytes } from "@/services/hostHealth";
import { handshakeChip } from "@/services/wireguard";
import OverviewWidget from "./OverviewWidget.vue";
const store = useControllerStore();
const tunnels = computed(() => (store.state.data?.active_transaction?.candidate ?? store.state.data?.desired)?.interfaces.filter(item => item.kind === "wireguard") ?? []);
const live = computed(() => new Map((store.runtime.data?.wireguard ?? []).map(item => [item.interface, item])));
const runtimeNote = computed(() => store.runtime.error ? "Runtime unavailable" : store.runtime.stale ? "Runtime stale" : undefined);
const rows = computed(() => tunnels.value.flatMap(tunnel =>
  tunnel.wireguard.peers.filter(peer => peer.enabled !== false).map(peer => {
    const stats = live.value.get(tunnel.name)?.peers.find(item => item.public_key === peer.public_key);
    return {
      key: `${tunnel.name}/${peer.public_key}`,
      endpoint: peer.endpoint || stats?.endpoint || "—",
      handshake: stats ? handshakeChip(stats.last_handshake_unix_seconds, peer.persistent_keepalive_seconds, store.runtime.lastSuccess ?? Date.now()) : undefined,
      received: stats?.rx_bytes,
      sent: stats?.tx_bytes,
    };
  })));
</script>

<template>
  <OverviewWidget
    title="WireGuard"
    to="/wireguard"
    :note="store.state.stale ? 'Configuration stale' : runtimeNote"
    :detail="store.runtime.error ?? undefined"
  >
    <v-table density="compact">
      <thead><tr><th>Peer</th><th>Last handshake</th><th>Received</th><th>Sent</th></tr></thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.key"
        >
          <td>{{ row.endpoint }}</td>
          <td>
            <v-chip
              v-if="row.handshake"
              :color="runtimeNote ? 'default' : row.handshake.color"
              :title="runtimeNote ? `${runtimeNote}. ${row.handshake.title}` : row.handshake.title"
              size="small"
              variant="tonal"
            >
              {{ row.handshake.label }}
            </v-chip>
            <span v-else>Unavailable</span>
          </td>
          <td :title="row.received">
            {{ row.received === undefined ? "Unavailable" : formatBytes(row.received) }}
          </td>
          <td :title="row.sent">
            {{ row.sent === undefined ? "Unavailable" : formatBytes(row.sent) }}
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="4">
            {{ store.state.data ? "No enabled WireGuard peers." : "WireGuard configuration unavailable." }}
          </td>
        </tr>
      </tbody>
    </v-table>
  </OverviewWidget>
</template>