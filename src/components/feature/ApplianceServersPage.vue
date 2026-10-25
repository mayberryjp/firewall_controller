<script setup lang="ts">
import { computed, ref } from "vue";
import { useControllerStore } from "@/stores/controller";
import { cloneConfig, validateConfig } from "@/services/configuration";
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
        Add server
      </v-btn>
    </div>
    <v-table class="service-table">
      <thead>
        <tr>
          <th scope="col">
            {{ service === 'ntp' ? 'Server' : 'Host' }}
          </th>
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
            <template v-if="service === 'syslog'">
              <td>{{ row.port }}</td>
              <td>{{ row.transport?.toUpperCase() }}</td>
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
          <td :colspan="service === 'syslog' ? 4 : 2">
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
