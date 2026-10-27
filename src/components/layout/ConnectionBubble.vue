<script setup lang="ts">
import { computed } from "vue";
import { useControllerStore } from "@/stores/controller";
import { formatTimestamp } from "@/services/timestamps";
import SafetyBanner from "@/components/layout/SafetyBanner.vue";
const store = useControllerStore();
defineEmits<{ disconnect: [] }>();
const deployment = import.meta.env.VITE_DEPLOYMENT_LABEL || "Unknown";
const mode = import.meta.env.VITE_BACKEND_MODE || "Unknown";
const readProblem = computed(() => [store.state, store.transactions].some(query =>
  Boolean(query.error) || (query.stale && query.lastSuccess !== null && !query.loading)));
const health = computed(() => store.healthStatus);
const healthLabel = computed(() => !health.value || health.value.stale ? "Unknown" :
  ({ healthy: "Healthy", unhealthy: "Unhealthy", unknown: "Unknown" }[health.value.process_health.status] ?? `Unknown (${health.value.process_health.status})`));
const healthProblem = computed(() => Boolean((store.platform.error && !store.platformUnsupported) ||
  (health.value && (health.value.stale || health.value.process_health.status !== "healthy" || health.value.active_alerts.length))));
const configurationProblem = computed(() => Boolean(store.uncertain || store.actionError || store.draftStale || store.state.data?.drift ||
  store.activeTransactions.some(item => item.status !== "pending_confirmation")));
const readIssues = computed(() => [
  { label: "Configuration", query: store.state }, { label: "Runtime", query: store.runtime }, { label: "Commits", query: store.transactions },
  { label: "Gateway measurements", query: store.gatewayStatistics }, { label: "Host measurements", query: store.hostHealth },
  { label: "MQTT", query: store.mqttStatus }, { label: "Dynamic DNS", query: store.dynamicDnsStatus }, { label: "mDNS", query: store.mdnsStatus },
].flatMap(({ label, query }) => query.error ? [{ label, message: query.error }] : []));
const serviceIssues = computed(() => {
  if (health.value) return [];
  const issues = new Map<string, { resource: string; message: string; retrying?: boolean }>();
  const add = (worker: { name?: string; interface?: string; state?: string; process_state?: string; error?: string | null; retrying?: boolean; warnings?: string[]; destination_errors?: string[]; failed_deliveries?: number }, fallback: string) => {
    const resource = worker.name ?? worker.interface ?? fallback;
    const messages = [worker.error, ...(worker.warnings ?? []), ...(worker.destination_errors ?? [])].filter(Boolean);
    if (worker.failed_deliveries) messages.push(`${worker.failed_deliveries} missed destination deliveries; missed records are not replayed.`);
    if (worker.retrying && !messages.length) messages.push("Recovering");
    const state = worker.state ?? worker.process_state;
    if (!messages.length && state && ["error", "unavailable", "stopped", "exited", "unhealthy", "not_running"].includes(state)) messages.push(`State: ${state}`);
    if (messages.length) issues.set(resource, { resource, message: messages.join("; "), retrying: worker.retrying });
  };
  store.runtime.data?.appliance_services.forEach(worker => add(worker, "Service"));
  store.runtime.data?.softflowd.forEach(worker => add(worker, "Flow export"));
  store.runtime.data?.dhcp_relay.forEach(worker => add(worker, "DHCP relay"));
  store.runtime.data?.gateway_monitors.forEach(worker => add(worker, "Gateway monitoring"));
  store.gatewayStatistics.data?.monitors.forEach(worker => add(worker, "Gateway monitoring"));
  store.mdnsStatus.data?.instances.forEach(worker => add(worker, "mDNS"));
  if (store.runtime.data?.error) issues.set("Runtime", { resource: "Runtime", message: store.runtime.data.error });
  if (store.mdnsStatus.data?.error) issues.set("mDNS status", { resource: "mDNS status", message: store.mdnsStatus.data.error });
  return [...issues.values()];
});
const connectionLabel = computed(() => !store.connected ? "Offline" : store.incompatible ? "API mismatch" :
  store.state.error || store.transactions.error ? "Read failed" : readProblem.value ? "Stale" :
  healthProblem.value || configurationProblem.value || serviceIssues.value.length || readIssues.value.length ? "Issues" : "Connected");
const expanded = computed(() => connectionLabel.value !== "Connected");
const connectionColor = computed(() => !store.connected ? "error" : expanded.value ? "warning" : "success");
const connectionIcon = computed(() => !store.connected ? "mdi-lan-disconnect" : expanded.value ? "mdi-alert-circle-outline" : "mdi-lan-connect");
</script>

<template>
  <v-menu
    location="top end"
    :offset="8"
    max-width="520"
    :close-on-content-click="false"
  >
    <template #activator="{ props }">
      <v-btn
        v-tooltip:top="connectionLabel"
        v-bind="props"
        class="connection-bubble"
        :color="connectionColor"
        :aria-label="connectionLabel"
        :icon="connectionIcon"
        variant="elevated"
        rounded="pill"
        :size="40"
      >
        <v-icon
          :icon="connectionIcon"
          aria-hidden="true"
        />
      </v-btn>
    </template>
    <v-list
      class="navigation-menu"
      aria-label="Registry session"
    >
      <v-list-item :title="connectionLabel" />
      <section
        v-if="store.connected"
        class="issues-panel pa-4"
        aria-label="Health and issues"
      >
        <div class="d-flex justify-space-between ga-3 mb-2">
          <strong>Process health: {{ healthLabel }}</strong>
          <span v-if="health?.stale">Stale last-known data</span>
        </div>
        <p class="text-caption text-medium-emphasis mb-3">
          Collected (UTC): {{ formatTimestamp(health?.process_health.collected_at) }}
        </p>
        <p
          v-if="store.platform.error && !store.platformUnsupported"
          class="text-caption mb-3"
        >
          Health status is unavailable. Last-known observations are retained.
        </p>
        <ul
          v-if="health?.active_alerts.length"
          class="issue-list"
          aria-label="Active alerts"
        >
          <li
            v-for="alert in health.active_alerts"
            :key="alert.id"
          >
            <div class="d-flex align-start ga-2">
              <v-icon
                :icon="alert.severity === 'error' ? 'mdi-alert-circle-outline' : 'mdi-alert-outline'"
                :color="alert.severity === 'error' ? 'error' : 'warning'"
                size="18"
                :aria-hidden="false"
                role="img"
                :aria-label="alert.severity"
              />
              <div>
                <strong>{{ alert.resource ?? alert.component }}</strong>
                <span v-if="alert.retrying"> · Recovering</span>
                <p>{{ alert.message }}</p>
                <p class="text-caption text-medium-emphasis">
                  First seen (UTC): {{ formatTimestamp(alert.first_seen_at) }}
                </p>
                <p class="text-caption text-medium-emphasis">
                  Last seen (UTC): {{ formatTimestamp(alert.last_seen_at) }}
                </p>
              </div>
            </div>
          </li>
        </ul>
        <ul
          v-else-if="serviceIssues.length"
          class="issue-list"
          aria-label="Service issues"
        >
          <li
            v-for="issue in serviceIssues"
            :key="issue.resource"
          >
            <strong>{{ issue.resource }}</strong><span v-if="issue.retrying"> · Recovering</span>
            <p>{{ issue.message }}</p>
          </li>
        </ul>
        <p
          v-else-if="health && !health.stale"
          class="text-caption"
        >
          No active alerts.
        </p>
        <details
          v-if="health?.process_health.components.length"
          class="mt-3"
        >
          <summary>Components</summary>
          <dl class="mt-2">
            <div
              v-for="component in health.process_health.components"
              :key="component.id"
              class="mb-2"
            >
              <dt>{{ component.resource ?? component.component }}: {{ component.state }}{{ component.retrying ? ' · Recovering' : '' }}</dt>
              <dd class="text-caption text-medium-emphasis">
                {{ health.stale || component.healthy === null ? 'Unknown' : component.healthy ? 'Healthy' : 'Unhealthy' }} · Collected (UTC): {{ formatTimestamp(component.collected_at) }}
              </dd>
            </div>
          </dl>
        </details>
        <ul
          v-if="readIssues.length"
          class="issue-list mt-3"
          aria-label="Read issues"
        >
          <li
            v-for="issue in readIssues"
            :key="String(issue.label)"
          >
            <strong>{{ issue.label }}</strong>: {{ issue.message }}
          </li>
        </ul>
        <SafetyBanner />
      </section>
      <v-list-item
        v-if="store.authError"
        :title="store.authError"
        class="connection-diagnostic"
      />
      <v-list-item
        v-if="store.connected && readProblem"
        title="Retry"
        prepend-icon="mdi-refresh"
        :disabled="store.state.loading || store.transactions.loading"
        @click="store.refresh"
      />
      <v-list-item
        :title="`Deployment: ${deployment}`"
        :subtitle="`Mode: ${mode} (operator supplied)`"
      />
      <v-list-item
        v-if="store.connected"
        title="Disconnect"
        prepend-icon="mdi-logout"
        :disabled="store.busy"
        @click="$emit('disconnect')"
      />
    </v-list>
  </v-menu>
</template>

<style scoped>
.connection-bubble { height: 40px; }
.issues-panel { max-height: min(65vh, 640px); overflow-y: auto; overflow-wrap: anywhere; }
.issue-list { list-style: none; padding: 0; margin: 0; }
.issue-list > li + li { margin-top: 12px; }
.connection-diagnostic :deep(.v-list-item-title) { white-space: normal; overflow-wrap: anywhere; }
</style>