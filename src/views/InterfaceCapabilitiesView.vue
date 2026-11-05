<script setup lang="ts">
import { useControllerStore } from "@/stores/controller";
import { useTimestamps } from "@/composables/useTimestamps";
import { useInterfaceCapabilities } from "@/composables/useInterfaceCapabilities";
import type { InterfaceCapabilities, PerformanceCapability } from "@/services/interfaceCapabilities";

const store = useControllerStore();
const { formatTimestamp, timeZone } = useTimestamps();
const { snapshot, completed, loading, error, stale, refreshDenied, read } = useInterfaceCapabilities();
const columns = [
  { name: "rss", title: "RSS" }, { name: "rps", title: "RPS" },
  { name: "rfs", title: "RFS" }, { name: "xps", title: "XPS" },
  { name: "xdp_native", title: "Native XDP" }, { name: "af_xdp_zero_copy", title: "AF_XDP zero-copy" },
];
const supportLabels = { supported: "Supported", unsupported: "Unsupported", unknown: "Unknown", not_applicable: "Not applicable" };
const capability = (row: InterfaceCapabilities, name: string) => row.capabilities.find(value => value.name === name);
function chip(feature?: PerformanceCapability) {
  if (feature?.support === "not_applicable") return { label: "N/A", color: "default" };
  if (feature?.support === "unsupported") return { label: "Unsupported", color: "error" };
  if (feature?.enabled === true) return { label: "Enabled", color: "success" };
  if (feature?.enabled === false) return { label: "Disabled", color: "warning" };
  if (feature?.support === "supported") return { label: "Supported", color: "info" };
  return { label: "Unknown", color: "default" };
}
function chipTitle(feature?: PerformanceCapability) {
  const enabled = feature?.enabled == null ? "Unknown" : feature.enabled ? "Yes" : "No";
  return `Support: ${supportLabels[feature?.support ?? "unknown"]}; enabled: ${enabled}`;
}
</script>

<template>
  <section
    class="interface-capabilities"
    aria-label="Interface capabilities"
  >
    <header class="capabilities-header">
      <h2>Interface capabilities</h2>
      <v-btn
        prepend-icon="mdi-refresh"
        :loading="loading"
        :disabled="!store.connected || loading || refreshDenied || Boolean(store.pathTestWriteBlockedReason)"
        :title="store.pathTestWriteBlockedReason"
        @click="read(true)"
      >
        Refresh capabilities
      </v-btn>
    </header>
    <p class="text-medium-emphasis">
      Refresh scans and saves capabilities without changing networking.
    </p>
    <p
      v-if="!store.connected"
      role="status"
    >
      Connect a firewall to read its saved capabilities.
    </p>
    <p
      v-if="loading"
      role="status"
    >
      Loading interface capabilities...
    </p>
    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      role="alert"
    >
      {{ error }}
    </v-alert>
    <p v-if="refreshDenied">
      Refresh requires state.read and interfaces.write permissions. Further scans are disabled for this firewall session.
    </p>
    <p
      v-if="stale"
      role="status"
    >
      Stale: previous saved capabilities retained after the failed request.
    </p>
    <p
      v-if="completed && !snapshot && !error"
      role="status"
    >
      No saved capability snapshot. Use Refresh capabilities to request a scan.
    </p>
    <template v-if="snapshot">
      <p v-if="snapshot.inventory.status === 'partial'">
        Partial snapshot.
      </p>
      <p v-if="snapshot.inventory.source === 'simulator'">
        Simulated inventory, not measured host hardware.
      </p>
      <p v-if="!snapshot.inventory.interfaces.length">
        No interfaces were reported in this saved snapshot.
      </p>
      <v-table
        v-else
        density="compact"
        class="capabilities-table"
        aria-label="Interface capability inventory"
      >
        <thead>
          <tr>
            <th scope="col">
              Interface
            </th><th scope="col">
              Driver
            </th><th scope="col">
              Observed link
            </th>
            <th
              v-for="column in columns"
              :key="column.name"
              scope="col"
            >
              {{ column.title }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in snapshot.inventory.interfaces"
            :key="row.name"
          >
            <th scope="row">
              {{ row.name }}<small>{{ row.kind }}</small>
            </th>
            <td>{{ row.driver?.name ?? "Unknown" }}</td>
            <td>
              {{ row.link?.speed_mbps == null ? "Speed: Unknown" : `${row.link.speed_mbps} Mbps` }}
              <small>Carrier: {{ row.link?.carrier == null ? "Unknown" : row.link.carrier ? "Up" : "Down" }}</small>
            </td>
            <td
              v-for="column in columns"
              :key="column.name"
            >
              <v-chip
                size="small"
                variant="tonal"
                :color="chip(capability(row, column.name)).color"
                :title="chipTitle(capability(row, column.name))"
              >
                {{ chip(capability(row, column.name)).label }}
              </v-chip>
            </td>
          </tr>
        </tbody>
      </v-table>
      <p class="snapshot-context text-caption text-medium-emphasis">
        Collected ({{ timeZone }}):
        <time :datetime="snapshot.collected_at">{{ formatTimestamp(snapshot.collected_at) }}</time>.
      </p>
    </template>
  </section>
</template>

<style scoped>
.interface-capabilities { min-width: 0; }
.capabilities-header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
.interface-capabilities > p, .interface-capabilities > .v-alert { margin-top: 12px; }
.snapshot-context { overflow-wrap: anywhere; }
.capabilities-table { margin-top: 16px; }
.capabilities-table small { display: block; white-space: nowrap; font-weight: normal; }
.capabilities-table :deep(table > thead > tr > th),
.capabilities-table :deep(table > tbody > tr > th),
.capabilities-table :deep(table > tbody > tr > td) { vertical-align: middle; padding: 8px; white-space: nowrap; }
.capabilities-table :deep(table > thead > tr > th) { white-space: normal; }
</style>
