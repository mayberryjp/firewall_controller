<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import DatasetStatus from "@/components/base/DatasetStatus.vue";
import { useControllerStore } from "@/stores/controller";
import { isInitialLoad } from "@/services/datasets";
import { useTimestamps } from "@/composables/useTimestamps";
import type { PlatformStatus } from "@/types/domain";
import { processRestartTarget, restartTargetSchema } from "@/services/operations";
const { formatTimestamp, timeZone } = useTimestamps();

type ComponentHealth = PlatformStatus["process_health"]["components"][number];
const store = useControllerStore();
const health = computed(() => store.healthStatus);
const overallLabels: Record<string, string> = { healthy: "Healthy", unhealthy: "Unhealthy", unknown: "Unknown" };
const overallLabel = computed(() => {
  if (!health.value || health.value.stale) return "Unknown";
  const status = health.value.process_health.status;
  return overallLabels[status] ?? `Unknown (${status})`;
});
const overallColor = computed(() => !health.value || health.value.stale ? "default" :
  health.value.process_health.status === "healthy" ? "success" : health.value.process_health.status === "unhealthy" ? "error" : "default");
const components = computed<ComponentHealth[]>(() => {
  const snapshot = health.value?.process_health;
  if (!snapshot) return [];
  const daemon = snapshot.daemon;
  return [
    ...(daemon ? [{
      id: "daemon", component: "daemon", resource: "netcontrold", state: daemon.state,
      healthy: daemon.healthy, retrying: false, collected_at: snapshot.collected_at,
    }] : []),
    ...snapshot.components,
  ];
});
function healthLabel(value: boolean | null): string {
  return health.value?.stale || value === null ? "Unknown" : value ? "Healthy" : "Unhealthy";
}
function healthColor(value: boolean | null): string {
  return health.value?.stale || value === null ? "default" : value ? "success" : "error";
}
function stateLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");
}
const componentLabels: Record<string, string> = {
  daemon: "Daemon", appliance_services: "Appliance service", dhcp_relay: "DHCP relay",
  softflowd: "NetFlow/IPFIX", gateway_monitors: "Gateway monitor", dhcp_client: "DHCP client",
  mqtt: "MQTT", dynamic_dns: "Dynamic DNS", managed_processes: "Managed process", system: "System settings",
};
const restartSelection = ref<{ id: string; target: string } | null>(null);
function restartUnavailable(row: ComponentHealth): string {
  const target = processRestartTarget(row, store.state.data?.desired);
  if (!target || !restartTargetSchema.safeParse(target).success) return "This observation has no supported restart target.";
  if (target === "netcontrold" && !health.value?.process_health.daemon?.watchdog_enabled) return "Daemon restart requires native host-mode systemd/watchdog supervision.";
  if (["disabled", "simulated"].includes(row.state) && !["mqtt", "dynamic-dns", "system", "netcontrold"].includes(target)) return "This native worker is disabled or simulated.";
  return store.operationBlockedReason;
}
function reviewRestart(row: ComponentHealth): void {
  const target = processRestartTarget(row, store.state.data?.desired);
  if (restartUnavailable(row) || !target) return;
  restartSelection.value = { id: row.id, target };
}
const selectedRow = computed(() => components.value.find(row => row.id === restartSelection.value?.id));
const selectedBlocked = computed(() => !selectedRow.value ||
  processRestartTarget(selectedRow.value, store.state.data?.desired) !== restartSelection.value?.target
  ? "Process observation changed. Cancel and review the restart again." : restartUnavailable(selectedRow.value));
async function restart(): Promise<void> {
  const selection = restartSelection.value;
  if (!selection || selectedBlocked.value) return;
  await store.restartProcess(selection.target);
  restartSelection.value = null;
}
watch(() => store.sessionVersion, () => { restartSelection.value = null; });
onMounted(() => { if (store.connected) void store.refreshPlatformStatus(); });
</script>

<template>
  <section aria-label="Process health">
    <DatasetStatus
      :query="store.platform"
      label="Process health"
    />
    <div class="health-summary mb-3">
      <strong>Overall health</strong>
      <v-chip
        :color="overallColor"
        size="small"
        variant="tonal"
      >
        {{ overallLabel }}
      </v-chip>
      <span class="text-caption text-medium-emphasis">
        Collected ({{ timeZone }}): {{ formatTimestamp(health?.process_health.collected_at) }}
      </span>
    </div>
    <p
      v-if="health?.stale"
      role="status"
      class="text-warning mb-3"
    >
      Stale last-known observations. Current process health is unknown.
    </p>
    <p
      v-if="health?.process_health.runtime_available === false"
      role="status"
      class="text-warning mb-3"
    >
      Native runtime could not be collected. Native component states are last-known observations.
    </p>
    <p
      v-if="!health && (store.platformUnsupported || !isInitialLoad(store.platform))"
      role="status"
      class="text-medium-emphasis mb-3"
    >
      {{ store.platformUnsupported ? 'This backend does not expose process health.' : 'Process health has not been observed yet.' }}
    </p>
    <v-table>
      <thead>
        <tr>
          <th>Component</th>
          <th>Resource</th>
          <th>State</th>
          <th>Health</th>
          <th>Actions</th>
          <th>Collected ({{ timeZone }})</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="component in components"
          :key="component.id"
        >
          <td>{{ componentLabels[component.component] ?? stateLabel(component.component) }}</td>
          <td>{{ component.resource ?? "Unavailable" }}</td>
          <td>
            <v-chip
              :color="health?.stale ? 'default' : component.retrying ? 'warning' : healthColor(component.healthy)"
              size="small"
              variant="tonal"
            >
              {{ stateLabel(component.state) }}{{ component.retrying ? ' · Recovering' : '' }}
            </v-chip>
          </td>
          <td>
            <v-chip
              :color="healthColor(component.healthy)"
              size="small"
              variant="tonal"
            >
              {{ healthLabel(component.healthy) }}
            </v-chip>
          </td>
          <td>
            <v-btn
              icon="mdi-restart"
              size="small"
              variant="text"
              :aria-label="`Restart ${component.resource ?? component.component}`"
              :disabled="Boolean(restartUnavailable(component))"
              :title="restartUnavailable(component) || `Restart ${processRestartTarget(component, store.state.data?.desired)}`"
              :loading="store.restartPending === processRestartTarget(component, store.state.data?.desired)"
              @click="reviewRestart(component)"
            />
          </td>
          <td class="health-time">
            {{ formatTimestamp(component.collected_at) }}
          </td>
        </tr>
        <tr v-if="!components.length">
          <td colspan="6">
            No component observations available.
          </td>
        </tr>
      </tbody>
    </v-table>
    <p
      v-if="store.restartNotice"
      role="status"
      class="mt-3"
    >
      {{ store.restartNotice }}
    </p>
    <p
      v-if="store.restartReconnecting"
      role="status"
      class="mt-3"
    >
      Waiting for management connectivity; your draft is preserved.
    </p>
    <p
      v-if="store.restartError"
      role="alert"
      class="text-error mt-3"
    >
      {{ store.restartError }}
    </p>
    <v-dialog
      :model-value="Boolean(restartSelection)"
      max-width="620"
      :persistent="Boolean(store.restartPending)"
      @update:model-value="value => { if (!value) restartSelection = null; }"
    >
      <v-card :title="`Restart ${restartSelection?.target}?`">
        <v-card-text>
          <p>Restarts this managed worker, not arbitrary OS processes. Requires system.restart. Desired configuration, revisions and accounting databases remain intact; your draft is preserved.</p>
          <p class="mt-3">
            Selected caches, counters and monitor baselines may reset. DHCP lease reacquisition can affect connectivity, and syslog deliveries may be missed. Restart does not verify upstream health.
          </p>
          <p
            v-if="restartSelection?.target === 'bgp'"
            class="mt-3"
          >
            BGP restart withdraws and relearns routes and dynamic WireGuard AllowedIPs. Static configuration is preserved.
          </p>
          <p
            v-if="restartSelection?.target === 'netcontrold'"
            class="mt-3"
          >
            The entire daemon, HTTP and SSH will stop temporarily. Recovery depends on the native host-mode systemd/watchdog service policy. Keep console access available. An acknowledgement is not a completed restart; an unknown outcome will not be automatically resubmitted.
          </p>
          <p
            v-if="selectedBlocked"
            role="alert"
            class="text-error mt-3"
          >
            {{ selectedBlocked }}
          </p>
        </v-card-text>
        <v-card-actions>
          <v-btn
            :disabled="Boolean(store.restartPending)"
            @click="restartSelection = null"
          >
            Cancel
          </v-btn>
          <v-btn
            color="warning"
            :disabled="Boolean(selectedBlocked)"
            :loading="Boolean(store.restartPending)"
            @click="restart"
          >
            Confirm restart
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <section
      v-if="health"
      aria-labelledby="process-alerts-title"
      class="mt-4"
    >
      <h2
        id="process-alerts-title"
        class="text-h6 mb-2"
      >
        {{ health.stale ? 'Last-known alerts' : 'Active alerts' }}
      </h2>
      <ul
        v-if="health.active_alerts.length"
        aria-label="Process alerts"
        class="process-alerts"
      >
        <li
          v-for="alert in health.active_alerts"
          :key="alert.id"
        >
          <div class="health-summary">
            <v-chip
              :color="alert.severity === 'error' ? 'error' : alert.severity === 'warning' ? 'warning' : 'default'"
              size="small"
              variant="tonal"
            >
              {{ stateLabel(alert.severity) }}
            </v-chip>
            <strong>{{ alert.resource ?? componentLabels[alert.component] ?? stateLabel(alert.component) }}</strong>
            <span v-if="alert.retrying">Recovering</span>
          </div>
          <p>{{ alert.message }}</p>
          <p class="text-caption text-medium-emphasis">
            First seen ({{ timeZone }}): {{ formatTimestamp(alert.first_seen_at) }}
          </p>
          <p class="text-caption text-medium-emphasis">
            Last seen ({{ timeZone }}): {{ formatTimestamp(alert.last_seen_at) }}
          </p>
        </li>
      </ul>
      <p v-else-if="!health.stale && health.process_health.runtime_available !== false">
        No active alerts.
      </p>
    </section>
  </section>
</template>

<style scoped>
.health-summary { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.health-time { white-space: nowrap; }
.process-alerts { display: grid; gap: 16px; list-style: none; padding: 0; }
</style>
