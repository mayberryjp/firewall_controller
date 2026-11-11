<script setup lang="ts">
import { computed, ref } from "vue";
import { useControllerStore } from "@/stores/controller";
import { useLogHistory } from "@/composables/useLogHistory";
import { useTimestamps } from "@/composables/useTimestamps";
import { getDHCPRelayLog } from "@/services/netcontrol";
import { formatInterfaceName } from "@/services/interfaceNames";
import type { DHCPRelayLogPage } from "@/services/dhcpDiagnostics";

const store = useControllerStore(), selectedInterface = ref<string | null>(null);
const filter = computed(() => selectedInterface.value?.trim() || undefined);
const { data, loading, error, stale } = useLogHistory(async (cursor, signal) => {
  const page = await getDHCPRelayLog({ cursor, interface: filter.value, limit: 100 }, signal);
  return { page, entries: page.events };
}, 1000, () => filter.value ?? "");
const { formatTimestamp, timeZone } = useTimestamps();
const interfaces = computed(() => [...new Set([
  ...(store.state.data?.desired.interfaces.map(row => row.name) ?? []),
  ...(data.value?.entries.flatMap(row => row.interface ? [row.interface] : []) ?? []),
])].sort());
const events: Record<DHCPRelayLogPage["events"][number]["event"], string> = {
  requests_received: "Request received", replies_received: "Reply received",
  requests_forwarded: "Request forwarded", replies_forwarded: "Reply forwarded",
  packets_rejected: "Rejected", send_errors: "Send error", transactions_expired: "Tracking expired",
  worker_start: "Worker started", worker_error: "Worker error",
};
const messages: Record<number, string> = { 1: "Discover", 2: "Offer", 3: "Request", 4: "Decline", 5: "ACK", 6: "NAK", 7: "Release", 8: "Inform" };
</script>

<template>
  <section aria-label="DHCP relay logs">
    <h1 class="text-h6 mb-4">
      DHCP relay logs
    </h1>
    <v-combobox
      v-model="selectedInterface"
      :items="interfaces"
      label="Interface"
      clearable
      density="compact"
      hide-details
      class="mb-3"
    />
    <p
      v-if="loading && !data"
      role="status"
    >
      Loading logs...
    </p>
    <p
      v-if="error"
      role="alert"
      class="text-error"
    >
      {{ error }}
    </p>
    <template v-if="data">
      <p
        v-if="stale"
        role="status"
      >
        Last-known logs.
      </p>
      <p
        v-if="data.gap"
        role="status"
      >
        Some relay events were overwritten.
      </p>
      <p
        v-if="data.reset"
        role="status"
      >
        Relay history restarted.
      </p>
      <p
        v-if="data.trimmed"
        role="status"
      >
        Older displayed entries removed.
      </p>
      <v-table density="compact">
        <thead>
          <tr>
            <th>Time ({{ timeZone }})</th><th>Interface</th><th>Event</th><th>DHCP message</th>
            <th>Peer</th><th>Transaction</th><th>Client MAC</th><th>Reason</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="entry in data.entries"
            :key="entry.sequence"
          >
            <td><time :datetime="entry.timestamp">{{ formatTimestamp(entry.timestamp) }}</time></td>
            <td>{{ entry.interface ? formatInterfaceName(entry.interface) : '-' }}</td>
            <td>{{ events[entry.event] }}</td>
            <td>{{ entry.message_type == null ? '-' : messages[entry.message_type] ?? entry.message_type }}</td>
            <td>{{ entry.peer ?? '-' }}</td><td>{{ entry.transaction_id ?? '-' }}</td>
            <td>{{ entry.client_mac ?? '-' }}</td><td class="log-reason">
              {{ entry.reason || '-' }}
            </td>
          </tr>
          <tr v-if="!data.entries.length">
            <td colspan="8">
              No relay events.
            </td>
          </tr>
        </tbody>
      </v-table>
    </template>
  </section>
</template>

<style scoped>
td { white-space: nowrap; }
.log-reason { white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
