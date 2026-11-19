<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useControllerStore } from "@/stores/controller";
import { cloneConfig, validateConfig } from "@/services/configuration";
import { useTimestamps } from "@/composables/useTimestamps";
import { isApplianceStatus, type Config } from "@/types/domain";
import ServiceWorkerStatus from "@/components/feature/ServiceWorkerStatus.vue";
import FirewallClock from "@/components/feature/FirewallClock.vue";
import { formatCount } from "@/services/counters";
import { useDiagnosticRead } from "@/composables/useDiagnosticRead";
import { getApplianceStatus } from "@/services/netcontrol";
const { formatTimestamp, timeZone } = useTimestamps();

interface Row { host: string; port?: number; transport?: string }
const props = defineProps<{ service: "ntp" | "syslog" }>();
const store = useControllerStore();
const syncSending = ref(false), syncTracking = ref(false), syncHost = ref("");
const syncError = ref(""), syncNotice = ref(""), syncDenied = ref(false), syncGeneration = ref(0);
const syncWorker = ref<string | null>(null);
let disposed = false;
const syncRead = useDiagnosticRead(async signal => {
  const page = await getApplianceStatus("ntp", signal);
  if (page.error) throw new Error(page.error);
  if (!page.instances.some(item => item.name === "ntp")) throw new Error("NTP worker status is unavailable.");
  return page;
}, 3000,
  () => String(syncGeneration.value), () => props.service === "ntp" && syncTracking.value && !syncSending.value);
const syncedStatus = computed(() => syncRead.data.value?.instances.find(item => item.name === "ntp" && syncWorker.value && item.started_at === syncWorker.value));
const syncBlocked = computed(() => syncSending.value || syncDenied.value || Boolean(store.operationBlockedReason) ||
  !store.state.data?.desired.ntp.enabled || store.state.stale || Boolean(store.state.error));
const stored = computed(() => store.activeTransactions.find(item => item.status === "pending_confirmation")?.candidate ?? store.state.data?.desired);
const editing = computed(() => store.draft ?? stored.value);
const title = computed(() => props.service === "ntp" ? "NTP" : "Syslog");
const rows = computed<Row[]>(() => props.service === "ntp"
  ? (editing.value?.ntp.servers ?? []).map(host => ({ host }))
  : (editing.value?.syslog.servers ?? []).map(({ host, port, transport }) => ({ host, port, transport })));
const blocked = computed(() => Boolean(store.readOnlyReason) || !editing.value);
const status = computed(() => props.service === "ntp" && syncTracking.value ? syncedStatus.value :
  store.runtime.data?.appliance_services.filter(isApplianceStatus).find(item => item.name === props.service));
const statusStale = computed(() => props.service === "ntp" && syncTracking.value
  ? syncRead.stale.value || Boolean(syncRead.error.value) : store.runtime.stale);
const sampleAvailable = computed(() => !statusStale.value && !status.value?.retrying && !status.value?.error && status.value?.sample_status === "available");
const statColumns = 4;
const clockSampleKey = ref("");
watch(() => sampleAvailable.value ? status.value : undefined, sample => {
  if (sample?.server_time && sample.collected_at) {
    clockSampleKey.value = JSON.stringify([sample.started_at, sample.collected_at, sample.server_time]);
  }
}, { immediate: true });
const syslogCounters = [
  { key: "received_records", title: "Logs read", color: "info" },
  { key: "forwarded_deliveries", title: "Remote sends", color: "primary" },
] as const;
const counterText = (key: typeof syslogCounters[number]["key"]) =>
  !store.runtime.data && store.runtime.loading ? "..." : formatCount(status.value?.[key]);
const ms = (value: number | null | undefined, signed = false) =>
  value === null || value === undefined ? "—" : `${signed && value > 0 ? "+" : ""}${value.toFixed(3).replace(/\.?0+$/, "")} ms`;
// Status applies to the synced server; before a server is known it is shown on the first row.
const activeIndex = computed(() => {
  if (!status.value) return -1;
  const server = status.value.server?.toLowerCase();
  return server ? rows.value.findIndex(row => row.host.toLowerCase() === server) : (rows.value.length ? 0 : -1);
});
const statusText = computed(() => {
  const current = status.value;
  if (!current) return "";
  if (statusStale.value) return `${current.state} · stale`;
  return sampleAvailable.value ? current.state : `${current.state} · ${(current.sample_status ?? "unavailable").replace("_", " ")}`;
});
const statusColor = computed(() => {
  const current = status.value;
  if (!current) return undefined;
  if (current.retrying || statusStale.value) return "warning";
  const byState: Record<string, string> = { running: "success", simulated: "info", stopped: "warning", disabled: "default", error: "error" };
  const stateColor = byState[current.state] ?? "default";
  if (stateColor !== "success" && stateColor !== "info") return stateColor;
  return ({ available: stateColor, warming_up: "warning", unavailable: "error" } as Record<string, string>)[current.sample_status ?? "unavailable"] ?? "warning";
});
const offsetColor = (value: number | null | undefined) => {
  if (value === null || value === undefined) return "default";
  const magnitude = Math.abs(value);
  return magnitude < 10 ? "success" : magnitude < 100 ? "warning" : "error";
};
const transportColors: Record<string, string> = { udp: "info", tcp: "primary", tls: "success" };
const statusTitle = computed(() => {
  const current = status.value;
  if (!current) return "";
  const parts = [`State: ${current.state}`, `Sample: ${(current.sample_status ?? "unavailable").replace("_", " ")}`];
  if (current.discipline) parts.push(`Discipline: ${current.discipline.replace("_", " ")}`);
  if (current.server_time) parts.push(`Last sync server time (${timeZone.value}): ${formatTimestamp(current.server_time)}`);
  if (current.collected_at) parts.push(`Last sample (${timeZone.value}): ${formatTimestamp(current.collected_at)}`);
  if (current.started_at) parts.push(`Started (${timeZone.value}): ${formatTimestamp(current.started_at)}`);
  return parts.join("\n");
});
const editIndex = ref<number | null>(null), form = ref<Row>({ host: "" }), error = ref("");
const transports = [{ title: "UDP", value: "udp" }, { title: "TCP", value: "tcp" }, { title: "TLS", value: "tls" }];

const list = computed<Row[]>(() => editIndex.value === -1 ? [...rows.value, { host: "" }] : rows.value);
const isEditing = (index: number) => editIndex.value !== null && (editIndex.value === index || (editIndex.value === -1 && index === rows.value.length));
function open(index: number | null): void {
  error.value = ""; editIndex.value = index ?? -1;
  form.value = index === null ? (props.service === "ntp" ? { host: "" } : { host: "", port: 514, transport: "udp" }) : { ...rows.value[index]! };
}
function close(): void { editIndex.value = null; error.value = ""; }
function commit(mutate: (candidate: Config) => void): void {
  if (!editing.value) throw new Error("Committed configuration is unavailable.");
  const candidate = cloneConfig(editing.value);
  mutate(candidate);
  candidate[props.service].enabled = candidate[props.service].servers.length > 0;
  const issues = validateConfig(candidate).filter(issue => issue.path === props.service || issue.path.startsWith(`${props.service}.`));
  if (issues.length) throw new Error(issues.map(issue => issue.message).join(". "));
  store.stage(candidate);
}
function stage(): void {
  error.value = "";
  try {
    const index = editIndex.value ?? -1, host = form.value.host.trim();
    commit(candidate => {
      if (props.service === "ntp") {
        if (index < 0) candidate.ntp.servers.push(host); else candidate.ntp.servers[index] = host;
      } else {
        const entry = { ...(index >= 0 ? candidate.syslog.servers[index] : {}), host, port: Number(form.value.port), transport: form.value.transport as "udp" | "tcp" | "tls" };
        if (index < 0) candidate.syslog.servers.push(entry); else candidate.syslog.servers[index] = entry;
      }
    });
    close();
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "Unable to stage the server"; }
}
function remove(index: number): void {
  error.value = "";
  try { commit(candidate => { candidate[props.service].servers.splice(index, 1); }); close(); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : "Unable to stage the change"; }
}
async function syncNow(host: string): Promise<void> {
  if (props.service !== "ntp" || syncBlocked.value || !store.state.data?.desired.ntp.servers.includes(host)) return;
  const session = store.sessionVersion;
  syncSending.value = true; syncTracking.value = true; syncHost.value = host; syncWorker.value = null;
  syncError.value = ""; syncNotice.value = ""; syncGeneration.value++;
  try {
    const result = await store.restartProcess("ntp");
    if (disposed || session !== store.sessionVersion) return;
    if (!result) {
      syncError.value = store.restartError || "Sync outcome is unknown. Check NTP status before trying again.";
      syncDenied.value = syncError.value.includes("HTTP 403:");
      syncTracking.value = syncError.value.startsWith("Restart outcome unknown.");
    } else if (result.status === "simulated") {
      syncNotice.value = "Simulated; the appliance clock was not changed.";
      syncTracking.value = false;
    } else {
      syncNotice.value = "Sync requested.";
      if (result.status === "restarted" && typeof result.worker.started_at === "string") syncWorker.value = result.worker.started_at;
      else syncError.value = "Sync was requested, but the new NTP worker could not be identified. Check status before trying again.";
    }
  } catch (failure) {
    if (disposed || session !== store.sessionVersion) return;
    syncError.value = failure instanceof Error ? failure.message : "Unable to request NTP sync.";
    syncTracking.value = false;
  } finally {
    if (!disposed && session === store.sessionVersion) syncSending.value = false;
  }
}
watch(() => [store.sessionVersion, props.service], () => {
  syncSending.value = false; syncTracking.value = false; syncHost.value = ""; syncWorker.value = null;
  syncError.value = ""; syncNotice.value = ""; syncDenied.value = false;
});
onBeforeUnmount(() => { disposed = true; });
</script>

<template>
  <section :aria-label="title">
    <v-alert
      v-if="store.readOnlyNotice"
      type="warning"
      variant="tonal"
      class="mb-4"
    >
      {{ store.readOnlyNotice }}
    </v-alert>
    <v-alert
      v-if="error"
      type="error"
      class="mb-4"
    >
      {{ error }}
    </v-alert>
    <div class="d-flex flex-wrap align-center ga-3 mb-5">
      <v-btn
        prepend-icon="mdi-plus"
        color="primary"
        :disabled="blocked"
        @click="open(null)"
      >
        {{ service === 'ntp' ? 'Add NTP upstream server' : 'Add remote syslog server' }}
      </v-btn>
    </div>
    <FirewallClock
      v-if="service === 'ntp'"
      :sample-key="clockSampleKey"
    />
    <p
      v-if="service === 'syslog' && status"
      class="mb-3"
    >
      <template v-if="store.runtime.stale">
        Stale last-known state:
      </template>
      <template v-if="status.forwarding_enabled !== undefined">
        Local capture:
      </template>
      <ServiceWorkerStatus :status="status" />
      <span v-if="status.forwarding_enabled !== undefined"> · Forwarding: {{ status.forwarding_enabled ? 'Enabled' : 'Disabled' }}</span>
      <span
        v-if="status.source"
        :title="status.host_source"
      >
        · Source: {{ status.source }}
      </span>
    </p>
    <template v-if="service === 'syslog'">
      <p
        v-if="store.runtime.error"
        role="alert"
        class="text-error"
      >
        {{ store.runtime.error }}
      </p>
      <p
        v-if="status?.error"
        role="alert"
        class="text-error"
      >
        {{ status.error }}
      </p>
      <p
        v-for="message in service === 'syslog' ? status?.destination_errors ?? [] : []"
        :key="message"
        role="alert"
        class="text-error"
      >
        {{ message }}
      </p>
    </template>
    <v-table class="service-table">
      <thead>
        <tr>
          <th scope="col">
            {{ service === 'ntp' ? 'Server' : 'Host' }}
          </th>
          <template v-if="service === 'ntp'">
            <th scope="col">
              Status
            </th>
            <th scope="col">
              Offset
            </th>
            <th scope="col">
              Delay
            </th>
            <th scope="col">
              Requested step
            </th>
          </template>
          <template v-if="service === 'syslog'">
            <th scope="col">
              Port
            </th>
            <th scope="col">
              Transport
            </th>
            <th
              v-for="column in syslogCounters"
              :key="column.key"
              scope="col"
            >
              {{ column.title }}
            </th>
          </template>
          <th
            v-if="service === 'ntp'"
            scope="col"
            class="column-sync text-center"
          >
            Sync
          </th>
          <th
            scope="col"
            class="column-actions"
          >
            Actions
          </th>
        </tr>
      </thead>
      <tbody>
        <template
          v-for="(row, index) in list"
          :key="`${index}/${row.host}`"
        >
          <tr v-if="!isEditing(index)">
            <td>{{ row.host }}</td>
            <template v-if="service === 'ntp'">
              <template v-if="index === activeIndex">
                <td :title="statusTitle">
                  <v-chip
                    size="small"
                    variant="tonal"
                    :color="statusColor"
                  >
                    <ServiceWorkerStatus
                      :status="status"
                      :label="statusText"
                    />
                  </v-chip>
                </td>
                <template v-if="sampleAvailable">
                  <td>
                    <v-chip
                      size="small"
                      variant="tonal"
                      :color="offsetColor(status?.offset_ms)"
                    >
                      {{ ms(status?.offset_ms, true) }}
                    </v-chip>
                  </td>
                  <td>
                    <v-chip
                      size="small"
                      variant="tonal"
                    >
                      {{ ms(status?.delay_ms) }}
                    </v-chip>
                  </td>
                  <td>
                    <v-chip
                      size="small"
                      variant="tonal"
                      color="primary"
                    >
                      {{ ms(status?.requested_step_ms, true) }}
                    </v-chip>
                  </td>
                </template>
                <td
                  v-else
                  :colspan="statColumns - 1"
                >
                  —
                </td>
              </template>
              <td
                v-else
                :colspan="statColumns"
              >
                —
              </td>
            </template>
            <template v-if="service === 'syslog'">
              <td>{{ row.port }}</td>
              <td>
                <v-chip
                  size="small"
                  variant="tonal"
                  :color="transportColors[row.transport ?? ''] ?? 'default'"
                >
                  {{ row.transport?.toUpperCase() }}
                </v-chip>
              </td>
              <template v-if="index === 0">
                <td
                  v-for="column in syslogCounters"
                  :key="column.key"
                  :rowspan="list.length"
                  :title="store.runtime.stale ? 'Last-known service totals' : 'Service total'"
                >
                  <v-chip
                    :color="status?.[column.key] == null ? 'default' : column.color"
                    size="small"
                    variant="tonal"
                  >
                    {{ counterText(column.key) }}
                  </v-chip>
                </td>
              </template>
            </template>
            <td
              v-if="service === 'ntp'"
              class="text-center"
            >
              <v-btn
                size="small"
                variant="outlined"
                color="primary"
                :aria-label="`Sync now ${row.host}`"
                title="Sync saved NTP servers now. Immediately steps the appliance clock and may affect logs, expiry, schedules and gateway measurements. Requires system.restart. Automatic polling is daily."
                :loading="syncSending && syncHost === row.host"
                :disabled="syncBlocked || !store.state.data?.desired.ntp.servers.includes(row.host)"
                @click="syncNow(row.host)"
              >
                Sync now
              </v-btn>
              <p
                v-if="syncHost === row.host && (syncError || syncRead.error.value || syncRead.data.value?.error)"
                role="alert"
                class="text-error text-caption"
              >
                {{ syncError || syncRead.error.value || syncRead.data.value?.error }}
              </p>
              <p
                v-else-if="syncHost === row.host && (syncSending || syncNotice)"
                role="status"
                class="text-caption"
              >
                {{ syncSending ? 'Requesting sync...' : syncNotice }}
              </p>
            </td>
            <td>
              <v-btn
                icon="mdi-pencil-outline"
                :aria-label="`Edit ${row.host}`"
                :title="`Edit ${row.host}`"
                size="x-small"
                variant="text"
                :disabled="blocked"
                @click="open(index)"
              />
              <v-btn
                icon="mdi-delete-outline"
                :aria-label="`Delete ${row.host}`"
                :title="`Delete ${row.host}`"
                size="x-small"
                variant="text"
                color="error"
                :disabled="blocked"
                @click="remove(index)"
              />
            </td>
          </tr>
          <tr v-else>
            <td>
              <v-text-field
                v-model="form.host"
                aria-label="Host"
                placeholder="IP or hostname"
                density="compact"
                hide-details
                autofocus
                @keydown.enter.prevent="stage"
              />
            </td>
            <td
              v-if="service === 'ntp'"
              :colspan="statColumns"
            />
            <td v-if="service === 'ntp'" />
            <template v-if="service === 'syslog'">
              <td>
                <v-number-input
                  v-model="form.port"
                  aria-label="Port"
                  :min="1"
                  :max="65535"
                  density="compact"
                  hide-details
                  control-variant="hidden"
                />
              </td>
              <td>
                <v-select
                  v-model="form.transport"
                  aria-label="Transport"
                  :items="transports"
                  density="compact"
                  hide-details
                />
              </td>
              <template v-if="index === 0">
                <td
                  v-for="column in syslogCounters"
                  :key="column.key"
                  :rowspan="list.length"
                  :title="store.runtime.stale ? 'Last-known service totals' : 'Service total'"
                >
                  <v-chip
                    :color="status?.[column.key] == null ? 'default' : column.color"
                    size="small"
                    variant="tonal"
                  >
                    {{ counterText(column.key) }}
                  </v-chip>
                </td>
              </template>
            </template>
            <td>
              <v-btn
                color="primary"
                size="small"
                :disabled="blocked"
                @click="stage"
              >
                Save
              </v-btn>
              <v-btn
                variant="text"
                size="small"
                @click="close"
              >
                Cancel
              </v-btn>
            </td>
          </tr>
        </template>
        <tr v-if="!rows.length && editIndex === null">
          <td :colspan="service === 'syslog' ? 3 : 3 + statColumns">
            No servers.
          </td>
          <template v-if="service === 'syslog'">
            <td
              v-for="column in syslogCounters"
              :key="column.key"
            >
              <v-chip
                :color="status?.[column.key] == null ? 'default' : column.color"
                size="small"
                variant="tonal"
              >
                {{ counterText(column.key) }}
              </v-chip>
            </td>
            <td />
          </template>
        </tr>
      </tbody>
    </v-table>
  </section>
</template>

<style scoped>
section { padding-bottom: 56px; }
.service-table :deep(th), .service-table :deep(td) { white-space: normal; overflow-wrap: anywhere; }
.service-table :deep(.column-actions) { width: 140px; }
.service-table :deep(.column-sync) { width: 132px; }
</style>
