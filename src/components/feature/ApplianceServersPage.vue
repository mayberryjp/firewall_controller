<script setup lang="ts">
import { computed, ref } from "vue";
import { useControllerStore } from "@/stores/controller";
import { cloneConfig, validateConfig } from "@/services/configuration";
import { formatTimestamp } from "@/services/timestamps";
import type { Config } from "@/types/domain";

interface Row { host: string; port?: number; transport?: string }
const props = defineProps<{ service: "ntp" | "syslog" }>();
const store = useControllerStore();
const stored = computed(() => store.activeTransactions.find(item => item.status === "pending_confirmation")?.candidate ?? store.state.data?.desired);
const editing = computed(() => store.draft ?? stored.value);
const title = computed(() => props.service === "ntp" ? "NTP" : "Syslog");
const rows = computed<Row[]>(() => props.service === "ntp"
  ? (editing.value?.ntp.servers ?? []).map(host => ({ host }))
  : (editing.value?.syslog.servers ?? []).map(({ host, port, transport }) => ({ host, port, transport })));
const blocked = computed(() => Boolean(store.readOnlyReason) || !editing.value);
const status = computed(() => props.service === "ntp" ? store.runtime.data?.appliance_services.find(item => item.name === "ntp") : undefined);
const sampleAvailable = computed(() => status.value?.sample_status === "available");
const statColumns = 5;
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
  return sampleAvailable.value ? current.state : `${current.state} · ${(current.sample_status ?? "unavailable").replace("_", " ")}`;
});
const statusColor = computed(() => {
  const current = status.value;
  if (!current) return undefined;
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
  if (current.collected_at) parts.push(`Last sample (UTC): ${formatTimestamp(current.collected_at)}`);
  if (current.started_at) parts.push(`Started (UTC): ${formatTimestamp(current.started_at)}`);
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
    <v-alert
      v-if="status?.error"
      type="warning"
      variant="tonal"
      class="mb-4"
    >
      {{ status.error }}
    </v-alert>
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
              Requested slew
            </th>
            <th scope="col">
              Uncorrected offset
            </th>
          </template>
          <template v-if="service === 'syslog'">
            <th scope="col">
              Port
            </th>
            <th scope="col">
              Transport
            </th>
          </template>
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
                    {{ statusText }}
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
                      {{ ms(status?.requested_slew_ms, true) }}
                    </v-chip>
                  </td>
                  <td>
                    <v-chip
                      size="small"
                      variant="tonal"
                      :color="offsetColor(status?.uncorrected_offset_ms)"
                    >
                      {{ ms(status?.uncorrected_offset_ms, true) }}
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
            </template>
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
          <td :colspan="service === 'syslog' ? 4 : 2 + statColumns">
            No servers.
          </td>
        </tr>
      </tbody>
    </v-table>
  </section>
</template>

<style scoped>
section { padding-bottom: 56px; }
.service-table :deep(th), .service-table :deep(td) { white-space: normal; overflow-wrap: anywhere; }
.service-table :deep(.column-actions) { width: 140px; }
</style>
