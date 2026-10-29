<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useControllerStore } from "@/stores/controller";
import { cloneConfig, stableJson } from "@/services/configuration";
import { eligibleUDPRelayInterface, validateUDPRelay } from "@/services/udpBroadcastRelay";
import { udpBroadcastRelaySchema, udpRelayInstanceSchema, type UDPBroadcastRelay, type UDPRelayInstance } from "@/types/domain";
import DatasetStatus from "@/components/base/DatasetStatus.vue";

const store = useControllerStore();
const applied = computed(() => store.state.data?.active_transaction?.candidate ?? store.state.data?.desired);
const selected = computed(() => store.draft ?? applied.value);
const relay = computed(() => selected.value?.udp_broadcast_relay);
const rows = computed(() => relay.value?.instances ?? []);
const blocked = computed(() => Boolean(store.readOnlyReason) || !relay.value);
const choices = computed(() => selected.value?.interfaces.filter(link => eligibleUDPRelayInterface(selected.value!, link)).map(link => link.name) ?? []);
const editing = ref<number | null>(null), error = ref(""), initial = ref(""), baseline = ref("");
const toggleVersion = ref(0);
const form = ref<UDPRelayInstance>({ id: 1, enabled: false, port: 4001, interfaces: [], multicast_address: null, source: "original" });
const displayName = ref("");
const restartSelection = ref<{ id: number; config: string } | null>(null);
const input = () => stableJson([form.value, displayName.value]);
watch(input, () => { store.editorDirty = editing.value !== null && input() !== initial.value; }, { flush: "sync" });
watch(() => store.sessionVersion, () => { close(); restartSelection.value = null; error.value = ""; });
onMounted(() => { if (store.connected && document.visibilityState !== "hidden") void store.refreshUDPRelayStatus(); });
onUnmounted(() => { store.editorDirty = false; });
function close(): void { editing.value = null; store.editorDirty = false; }
function open(id: number, preset?: "govee" | "echonet"): void {
  error.value = "";
  const row = rows.value.find(value => value.id === id);
  const unused = Array.from({ length: 63 }, (_, index) => index + 1).find(value => !rows.value.some(item => item.id === value));
  if (id === -1 && unused === undefined) { error.value = "At most 63 relay instances."; return; }
  form.value = row ? { ...row, interfaces: [...row.interfaces] } : {
    id: unused ?? 1, enabled: false, port: preset === "echonet" ? 3610 : 4001, interfaces: [],
    multicast_address: preset === "echonet" ? "224.0.23.0" : preset === "govee" ? "239.255.255.250" : null, source: "original",
  };
  const metadata = row?.metadata;
  displayName.value = metadata?.display_name ?? (preset === "govee" ? "Govee" : preset === "echonet" ? "ECHONET Lite" : "");
  editing.value = id; baseline.value = stableJson(relay.value); initial.value = input(); store.editorDirty = false;
}
function commit(value: UDPBroadcastRelay): void {
  if (blocked.value || !selected.value) throw new Error(store.readOnlyReason || "A backend with UDP Broadcast Relay support is required.");
  const candidate = cloneConfig(selected.value);
  candidate.udp_broadcast_relay = udpBroadcastRelaySchema.parse({ ...value, enabled: value.instances.some(instance => instance.enabled) });
  const issues = validateUDPRelay(candidate);
  if (issues.length) throw new Error(issues.map(issue => issue.message).join(". "));
  store.stage(candidate);
}
function perform(action: () => void): void {
  error.value = "";
  try { action(); } catch (failure) { toggleVersion.value++; error.value = failure instanceof Error ? failure.message : "Unable to stage relay changes"; }
}
function save(): void {
  perform(() => {
    if (!relay.value || stableJson(relay.value) !== baseline.value) throw new Error("Relay settings changed. Cancel and reopen the editor.");
    const metadata = { description: "", ...form.value.metadata, display_name: displayName.value };
    const instance = udpRelayInstanceSchema.parse({ ...form.value, multicast_address: form.value.multicast_address?.trim() || null, metadata });
    const instances = [...rows.value];
    if (editing.value === -1) instances.push(instance);
    else {
      const index = instances.findIndex(row => row.id === editing.value);
      if (index < 0) throw new Error("Instance is no longer available");
      instances[index] = instance;
    }
    commit({ ...relay.value, instances });
    close();
  });
}
function toggleRow(id: number, value: boolean | null): void {
  perform(() => { if (relay.value) commit({ ...relay.value, instances: rows.value.map(row => row.id === id ? { ...row, enabled: value === true } : row) }); });
}
function remove(id: number): void { perform(() => { if (relay.value) commit({ ...relay.value, instances: rows.value.filter(row => row.id !== id) }); }); }
function observation(id: number) { return store.udpRelayStatus.data?.instances.find(row => row.instance_id === id); }
function identity(row: UDPRelayInstance, enabled: boolean) {
  return stableJson({ enabled: enabled && row.enabled, port: row.port, interfaces: [...row.interfaces].sort(), multicast_address: row.multicast_address, source: row.source });
}
function current(row: UDPRelayInstance): boolean {
  const status = observation(row.id), active = applied.value?.udp_broadcast_relay?.instances.find(value => value.id === row.id);
  return Boolean(store.udpRelayStatusCurrent && status && active &&
    identity(row, relay.value?.enabled === true) === identity(active, applied.value?.udp_broadcast_relay?.enabled === true) &&
    identity(row, relay.value?.enabled === true) === identity({ ...status, id: status.instance_id }, true));
}
function restartBlocked(id: number): string {
  const row = rows.value.find(value => value.id === id), status = observation(id);
  if (!row || !current(row) || !status?.enabled || status.state === "simulated") return "A current, applied native instance is required.";
  return store.operationBlockedReason;
}
function reviewRestart(id: number): void {
  if (!restartBlocked(id)) restartSelection.value = { id, config: stableJson(applied.value?.udp_broadcast_relay) };
}
const restartReason = computed(() => !restartSelection.value ? "" : restartSelection.value.config !== stableJson(applied.value?.udp_broadcast_relay)
  ? "Applied settings changed. Cancel and review the restart again." : restartBlocked(restartSelection.value.id));
async function restart(): Promise<void> {
  if (!restartSelection.value || restartReason.value) return;
  await store.restartProcess(`udp-broadcast-relay:${restartSelection.value.id}`);
  restartSelection.value = null;
}
</script>

<template>
  <section aria-label="UDP Broadcast Relay">
    <DatasetStatus
      :query="store.state"
      label="Committed configuration"
    />
    <p
      v-if="store.state.data && !relay"
      role="alert"
      class="text-warning mb-3"
    >
      Deploy a backend with UDP Broadcast Relay support before editing this service.
    </p>
    <div class="relay-toolbar mb-4">
      <div class="d-flex flex-wrap ga-2">
        <v-btn
          prepend-icon="mdi-plus"
          color="primary"
          :disabled="blocked || editing !== null || rows.length >= 63"
          @click="open(-1)"
        >
          Add instance
        </v-btn>
        <v-menu>
          <template #activator="{ props }">
            <v-btn
              v-bind="props"
              prepend-icon="mdi-playlist-plus"
              :disabled="blocked || editing !== null || rows.length >= 63"
            >
              Presets
            </v-btn>
          </template>
          <v-list density="compact">
            <v-list-item
              title="Govee"
              @click="open(-1, 'govee')"
            />
            <v-list-item
              title="ECHONET Lite"
              @click="open(-1, 'echonet')"
            />
          </v-list>
        </v-menu>
      </div>
    </div>
    <p
      v-if="error"
      role="alert"
      class="text-error mb-3"
    >
      {{ error }}
    </p>
    <form
      v-if="editing !== null"
      class="relay-editor mb-4"
      aria-label="Relay instance editor"
      @submit.prevent="save"
    >
      <template v-if="editing !== null">
        <v-text-field
          v-model.number="form.id"
          :disabled="blocked"
          type="number"
          min="1"
          max="63"
          label="Instance ID"
          hide-details
        />
        <v-text-field
          v-model.number="form.port"
          :disabled="blocked"
          type="number"
          min="1"
          max="65535"
          label="UDP port"
          hide-details
        />
        <v-select
          v-model="form.interfaces"
          :disabled="blocked"
          :items="choices"
          label="Interfaces"
          multiple
          chips
          closable-chips
          hide-details
          class="relay-wide"
        />
        <v-text-field
          v-model="form.multicast_address"
          :disabled="blocked"
          label="Multicast group (optional)"
          hide-details
        />
      </template>
      <v-text-field
        v-model="displayName"
        :disabled="blocked"
        label="Display name"
        hide-details
        :maxlength="128"
      />
      <div class="relay-wide d-flex ga-2">
        <v-btn
          type="submit"
          prepend-icon="mdi-check"
          color="primary"
          :disabled="blocked"
        >
          Stage changes
        </v-btn>
        <v-btn
          prepend-icon="mdi-close"
          variant="text"
          @click="close"
        >
          Cancel
        </v-btn>
      </div>
    </form>
    <DatasetStatus
      :query="store.udpRelayStatus"
      label="Relay status"
    />
    <p
      v-if="store.udpRelayStatus.data?.error"
      role="alert"
      class="text-error mb-3"
    >
      {{ store.udpRelayStatus.data.error }}
    </p>
    <v-table class="inline-table relay-table">
      <thead><tr><th>Instance</th><th>Enabled</th><th>UDP port</th><th>Interfaces</th><th>Multicast Address</th><th>Actions</th></tr></thead>
      <tbody>
        <template
          v-for="row in rows"
          :key="row.id"
        >
          <tr>
            <td>
              <span class="relay-mobile-label">Instance</span>{{ row.metadata?.display_name || `Relay ${row.id}` }} <span
                v-if="row.metadata?.display_name"
                class="text-medium-emphasis"
              >#{{ row.id }}</span>
            </td>
            <td>
              <span class="relay-mobile-label">Enabled</span>
              <v-switch
                :key="String(row.enabled) + toggleVersion"
                :model-value="row.enabled"
                :aria-label="`Enable relay ${row.id}`"
                color="primary"
                hide-details
                density="compact"
                :disabled="blocked || editing !== null"
                @update:model-value="toggleRow(row.id, $event)"
              />
            </td>
            <td><span class="relay-mobile-label">UDP port</span>{{ row.port }}</td>
            <td><span class="relay-mobile-label">Interfaces</span>{{ row.interfaces.join(', ') }}</td>
            <td><span class="relay-mobile-label">Multicast Address</span>{{ row.multicast_address || 'Broadcast only' }}</td>
            <td class="relay-actions">
              <v-btn
                icon="mdi-pencil-outline"
                size="small"
                variant="text"
                :title="`Edit relay ${row.id}`"
                :aria-label="`Edit relay ${row.id}`"
                :disabled="blocked || editing !== null"
                @click="open(row.id)"
              />
              <v-btn
                icon="mdi-delete-outline"
                color="error"
                size="small"
                variant="text"
                :title="`Delete relay ${row.id}`"
                :aria-label="`Delete relay ${row.id}`"
                :disabled="blocked || editing !== null"
                @click="remove(row.id)"
              />
              <v-btn
                icon="mdi-restart"
                size="small"
                variant="text"
                :title="restartBlocked(row.id) || `Restart relay ${row.id}`"
                :aria-label="`Restart relay ${row.id}`"
                :disabled="Boolean(restartBlocked(row.id))"
                @click="reviewRestart(row.id)"
              />
            </td>
          </tr>
        </template>
        <tr v-if="!rows.length">
          <td colspan="6">
            No relay instances.
          </td>
        </tr>
      </tbody>
    </v-table>
    <p
      v-if="store.restartError"
      role="alert"
      class="text-error mt-3"
    >
      {{ store.restartError }}
    </p>
    <p
      v-if="store.restartNotice"
      role="status"
      class="mt-3"
    >
      {{ store.restartNotice }}
    </p>
    <v-dialog
      :model-value="restartSelection !== null"
      max-width="520"
      :persistent="Boolean(store.restartPending)"
      @update:model-value="!$event && (restartSelection = null)"
    >
      <v-card :title="`Restart relay ${restartSelection?.id}?`">
        <v-card-text>
          Discovery is briefly interrupted and counters reset. Saved configuration and local drafts are retained. Restart does not confirm discovery or reply delivery.
          <p
            v-if="restartReason"
            role="alert"
            class="text-error mt-3"
          >
            {{ restartReason }}
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
            prepend-icon="mdi-restart"
            :disabled="Boolean(restartReason)"
            :loading="Boolean(store.restartPending)"
            @click="restart"
          >
            Restart
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
.relay-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.relay-toolbar > .v-input { flex: 0 1 auto; }
.relay-editor { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; padding-block: 16px; border-block: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); }
.relay-wide { grid-column: 1 / -1; }
.relay-table :deep(td) { white-space: normal; overflow-wrap: anywhere; }
.relay-table :deep(td:nth-child(5)) { white-space: nowrap; }
.relay-actions { min-width: 126px; white-space: nowrap !important; }
.relay-mobile-label { display: none; }
.relay-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px 24px; padding-block: 12px; }
.relay-metrics dt { font-size: 0.75rem; color: rgb(var(--v-theme-on-surface-variant)); }
.relay-metrics dd { margin: 0; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
@media (max-width: 960px) {
  .relay-table :deep(thead) { display: none; }
  .relay-table :deep(table), .relay-table :deep(tbody), .relay-table :deep(tr) { display: block; width: 100%; }
  .relay-table :deep(tr:not(.relay-details)) { padding-block: 12px; }
  .relay-table :deep(td) { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 36px; height: auto !important; padding-block: 4px; }
  .relay-table :deep(td > .v-input) { flex: 0 0 auto; }
  .relay-table :deep(.relay-details td) { display: block; }
  .relay-table :deep(.relay-actions) { justify-content: flex-end; gap: 0; }
  .relay-mobile-label { display: inline; color: rgb(var(--v-theme-on-surface-variant)); font-size: 0.75rem; flex-shrink: 0; }
  .relay-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 600px) {
  .relay-editor { grid-template-columns: minmax(0, 1fr); }
}
</style>