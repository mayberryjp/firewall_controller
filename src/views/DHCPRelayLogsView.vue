<script setup lang="ts">
import { computed, ref } from "vue";
import { useLogHistory } from "@/composables/useLogHistory";
import { useTimestamps } from "@/composables/useTimestamps";
import { getDHCPRelayLog } from "@/services/netcontrol";
import { formatInterfaceName } from "@/services/interfaceNames";
import type { DHCPRelayLogPage } from "@/services/dhcpDiagnostics";

type RelayEvent = DHCPRelayLogPage["events"][number]["event"];
const selectedMAC = ref("");
const selectedEvent = ref<"" | "failures" | RelayEvent>("");
const { data, loading, error, stale } = useLogHistory(async (cursor, signal) => {
  const page = await getDHCPRelayLog({ cursor, limit: 100 }, signal);
  return { page, entries: page.events };
}, 1000, () => "");
const { formatTimestamp, timeZone } = useTimestamps();
const macAddresses = computed(() => [
  { title: "All MAC addresses", value: "" },
  ...[...new Set([
    ...(selectedMAC.value ? [selectedMAC.value] : []),
    ...(data.value?.entries.flatMap(row => row.client_mac ? [row.client_mac.toUpperCase()] : []) ?? []),
  ])].sort().map(value => ({ title: value, value })),
]);
const events: Record<RelayEvent, string> = {
  requests_received: "Request received", replies_received: "Reply received",
  requests_forwarded: "Request forwarded", replies_forwarded: "Reply forwarded",
  packets_rejected: "Rejected", send_errors: "Send error", transactions_expired: "Tracking expired",
  worker_start: "Worker started", worker_error: "Worker error",
};
const eventColors: Record<RelayEvent, string> = {
  requests_received: "info", replies_received: "primary",
  requests_forwarded: "success", replies_forwarded: "teal",
  packets_rejected: "error", send_errors: "error", transactions_expired: "warning",
  worker_start: "secondary", worker_error: "error",
};
const eventChoices = [
  { title: "All events", value: "" },
  { title: "Failures only", value: "failures" },
  ...Object.entries(events).map(([value, title]) => ({ title, value })),
];
const failureEvents: RelayEvent[] = ["packets_rejected", "send_errors", "worker_error"];
const visibleEntries = computed(() => (data.value?.entries ?? []).filter(entry =>
  (!selectedMAC.value || entry.client_mac?.toUpperCase() === selectedMAC.value) &&
  (!selectedEvent.value || (selectedEvent.value === "failures"
    ? failureEvents.includes(entry.event) : entry.event === selectedEvent.value)),
));
const reasonColors = ["warning", "error", "info", "secondary", "orange", "teal", "purple"];
const assignedReasonColors = new Map<string, string>();
function reasonColor(reason: string): string {
  const existing = assignedReasonColors.get(reason);
  if (existing) return existing;
  const color = reasonColors[assignedReasonColors.size % reasonColors.length]!;
  assignedReasonColors.set(reason, color);
  return color;
}
const messages: Record<number, string> = { 1: "Discover", 2: "Offer", 3: "Request", 4: "Decline", 5: "ACK", 6: "NAK", 7: "Release", 8: "Inform" };
</script>

<template>
  <section aria-label="DHCP relay logs">
    <h1 class="text-h6 mb-4">
      DHCP relay logs
    </h1>
    <div class="log-filters mb-3">
      <v-select
        v-model="selectedMAC"
        :items="macAddresses"
        label="Client MAC"
        aria-label="Client MAC"
        density="compact"
        hide-details
      />
      <v-select
        v-model="selectedEvent"
        :items="eventChoices"
        label="Event"
        aria-label="Event"
        density="compact"
        hide-details
      />
    </div>
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
            v-for="entry in visibleEntries"
            :key="entry.sequence"
          >
            <td><time :datetime="entry.timestamp">{{ formatTimestamp(entry.timestamp) }}</time></td>
            <td>{{ entry.interface ? formatInterfaceName(entry.interface) : '-' }}</td>
            <td>
              <v-chip
                :color="eventColors[entry.event]"
                variant="tonal"
                size="small"
              >
                {{ events[entry.event] }}
              </v-chip>
            </td>
            <td>{{ entry.message_type == null ? '-' : messages[entry.message_type] ?? entry.message_type }}</td>
            <td>{{ entry.peer ?? '-' }}</td><td>{{ entry.transaction_id ?? '-' }}</td>
            <td>{{ entry.client_mac?.toUpperCase() ?? '-' }}</td><td class="log-reason">
              <v-chip
                v-if="entry.reason"
                :color="reasonColor(entry.reason)"
                variant="tonal"
                size="small"
                class="reason-chip"
              >
                {{ entry.reason }}
              </v-chip>
              <template v-else>
                -
              </template>
            </td>
          </tr>
          <tr v-if="!visibleEntries.length">
            <td colspan="8">
              {{ selectedMAC || selectedEvent ? 'No matching relay events.' : 'No relay events.' }}
            </td>
          </tr>
        </tbody>
      </v-table>
    </template>
  </section>
</template>

<style scoped>
td { white-space: nowrap; }
.log-filters { display: flex; flex-wrap: wrap; gap: 12px; }
.log-filters > * { flex: 1 1 240px; }
.log-reason { white-space: pre-wrap; overflow-wrap: anywhere; }
.reason-chip { max-width: 100%; height: auto; min-height: 26px; white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
