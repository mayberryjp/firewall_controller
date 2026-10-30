<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useControllerStore } from "@/stores/controller";
import { isInitialLoad } from "@/services/datasets";
import { cloneConfig, stableJson, validateConfig } from "@/services/configuration";
import { uploadDynamicDnsSecret } from "@/services/netcontrol";
import { useTimestamps } from "@/composables/useTimestamps";
import type { DynamicDnsEntry } from "@/types/domain";
const { formatTimestamp, timeZone } = useTimestamps();

const store = useControllerStore();
const selected = computed(() => store.draft ?? store.state.data?.desired);
const entries = computed(() => selected.value?.dynamic_dns ?? []);
const blank = (): DynamicDnsEntry => ({
  name: "", enabled: true, source_interface: "", address_source: "public_ip", tenant_id: "", client_id: "", secret_ref: "",
  zone_resource_id: "", record_name: "", ttl_seconds: 300, interval_seconds: 300,
});
const editing = ref<number | null>(null), form = ref<DynamicDnsEntry>(blank()), secret = ref("");
const error = ref(""), saving = ref(false);
const blocked = computed(() => Boolean(store.readOnlyReason) || !selected.value || saving.value);
const interfaces = computed(() => (selected.value?.interfaces ?? []).filter(item => item.up).map(item => item.name));
const sources = [{ title: "Public IP (detected via ipify)", value: "public_ip" }, { title: "Interface address", value: "interface" }];
const statuses = computed(() => new Map((store.dynamicDnsStatus.data?.entries ?? []).map(item => [item.name, item])));
let upload: AbortController | undefined, alive = true;
onMounted(() => { if (store.connected && document.visibilityState !== "hidden") void store.refreshDynamicDnsStatus(); });
onUnmounted(() => { alive = false; secret.value = ""; upload?.abort(); });

function open(index: number | null): void {
  error.value = ""; secret.value = ""; editing.value = index ?? -1;
  form.value = index === null ? blank() : { ...entries.value[index]! };
}
function close(): void { editing.value = null; secret.value = ""; error.value = ""; }
function commit(change: (candidate: ReturnType<typeof cloneConfig>) => void): boolean {
  if (!selected.value) return false;
  const candidate = cloneConfig(selected.value);
  change(candidate);
  if (!candidate.dynamic_dns?.length) delete candidate.dynamic_dns;
  store.stage(candidate);
  return true;
}
function toggle(index: number, enabled: boolean): void {
  error.value = "";
  try { commit(candidate => { candidate.dynamic_dns![index]!.enabled = enabled; }); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : "Unable to stage the change"; }
}
function remove(index: number): void {
  error.value = "";
  try { commit(candidate => { candidate.dynamic_dns!.splice(index, 1); }); if (editing.value !== null) close(); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : "Unable to stage the change"; }
}
async function stage(): Promise<void> {
  error.value = "";
  if (blocked.value || !selected.value || editing.value === null) { secret.value = ""; return; }
  saving.value = true; upload = new AbortController();
  const index = editing.value < 0 ? entries.value.length : editing.value;
  const initial = stableJson(entries.value);
  try {
    const entry = { ...form.value, name: form.value.name.trim() };
    const candidate = cloneConfig(selected.value);
    candidate.dynamic_dns = [...(candidate.dynamic_dns ?? [])];
    candidate.dynamic_dns[index] = entry;
    if (!secret.value && !entry.secret_ref) throw new Error("Enter the Azure client secret");
    const issues = validateConfig(candidate).filter(issue => issue.path.startsWith(`dynamic_dns.${index}.`) || issue.path === "dynamic_dns");
    if (issues.length) throw new Error(issues.map(issue => issue.message).join(". "));
    if (secret.value) {
      const result = await uploadDynamicDnsSecret(secret.value, upload.signal);
      if (!alive || upload.signal.aborted || !store.connected) return;
      entry.secret_ref = result.secret_ref;
    }
    if (!alive || upload.signal.aborted) return;
    if (stableJson(entries.value) !== initial) throw new Error("Dynamic DNS settings changed during the secret upload. Review the current settings before saving.");
    commit(latest => { latest.dynamic_dns = [...(latest.dynamic_dns ?? [])]; latest.dynamic_dns[index] = entry; });
    close();
  } catch (cause) {
    if (alive && !upload.signal.aborted) error.value = cause instanceof Error ? cause.message : "Unable to save Dynamic DNS settings";
  } finally { secret.value = ""; saving.value = false; }
}
function zone(entry: DynamicDnsEntry): string { return entry.zone_resource_id.split("/").pop() ?? ""; }
function host(entry: DynamicDnsEntry): string { return entry.record_name === "@" ? zone(entry) : `${entry.record_name}.${zone(entry)}`; }
function stateColor(state?: string): string {
  return store.dynamicDnsStatus.stale ? "default" : state === "current" ? "success" : state === "error" ? "error" : state === "checking" ? "warning" : "default";
}
function stateLabel(name: string): string {
  if (isInitialLoad(store.dynamicDnsStatus)) return "—";
  const item = statuses.value.get(name);
  return store.dynamicDnsStatus.stale ? (item ? "Stale" : "Unavailable") : item?.state ?? "Unavailable";
}
function updated(name: string): string {
  const seconds = statuses.value.get(name)?.last_updated_at_unix;
  return seconds == null ? "—" : formatTimestamp(seconds * 1000);
}
</script>

<template>
  <section aria-label="Dynamic DNS settings">
    <div class="d-flex align-center mb-4">
      <h1 class="text-h6 mr-auto">
        Dynamic DNS
      </h1>
      <v-btn
        prepend-icon="mdi-plus"
        color="primary"
        :disabled="blocked || entries.length >= 32"
        @click="open(null)"
      >
        Add entry
      </v-btn>
    </div>
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
    <v-table class="ddns-table">
      <thead>
        <tr>
          <th scope="col">
            Hostname
          </th>
          <th scope="col">
            Status
          </th>
          <th scope="col">
            Source
          </th>
          <th scope="col">
            State
          </th>
          <th scope="col">
            Address
          </th>
          <th scope="col">
            Last updated ({{ timeZone }})
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
        <tr
          v-for="(entry, index) in entries"
          :key="entry.name"
        >
          <td>
            <div>{{ host(entry) }}</div>
            <div class="text-caption text-medium-emphasis">
              {{ entry.name }}
            </div>
          </td>
          <td>
            <v-switch
              :model-value="entry.enabled"
              :aria-label="`Dynamic DNS enabled for ${entry.name}`"
              :disabled="blocked"
              density="compact"
              hide-details
              color="primary"
              @update:model-value="toggle(index, Boolean($event))"
            />
          </td>
          <td>{{ entry.address_source === 'public_ip' ? 'Public IP' : 'Interface' }} · {{ entry.source_interface }}</td>
          <td>
            <v-chip
              :color="stateColor(statuses.get(entry.name)?.state)"
              size="small"
              variant="tonal"
              :title="statuses.get(entry.name)?.error ?? undefined"
            >
              {{ stateLabel(entry.name) }}
            </v-chip>
          </td>
          <td>{{ statuses.get(entry.name)?.address ?? '—' }}</td>
          <td>{{ updated(entry.name) }}</td>
          <td>
            <v-btn
              icon="mdi-pencil-outline"
              :aria-label="`Edit ${entry.name}`"
              :title="`Edit ${entry.name}`"
              size="x-small"
              variant="text"
              :disabled="blocked"
              @click="open(index)"
            />
            <v-btn
              icon="mdi-delete-outline"
              :aria-label="`Delete ${entry.name}`"
              :title="`Delete ${entry.name}`"
              size="x-small"
              variant="text"
              color="error"
              :disabled="blocked"
              @click="remove(index)"
            />
          </td>
        </tr>
        <tr v-if="!entries.length">
          <td colspan="7">
            No Dynamic DNS entries.
          </td>
        </tr>
      </tbody>
    </v-table>
    <p class="setting-desc mt-3">
      Disabling or deleting an entry leaves its Azure DNS record in place, and rolling back a configuration cannot undo DNS writes already made.
      Public IP detection contacts ipify and does not make a host behind carrier-grade NAT reachable.
    </p>
    <form
      v-if="editing !== null"
      class="ddns-form"
      :aria-label="editing < 0 ? 'Add Dynamic DNS entry' : `Edit ${form.name}`"
      @submit.prevent="stage"
    >
      <div class="ddns-grid">
        <v-text-field
          v-model="form.name"
          label="Name"
          :disabled="blocked"
          density="compact"
          hide-details="auto"
        />
        <v-select
          v-model="form.source_interface"
          label="Interface"
          :items="interfaces"
          :disabled="blocked"
          density="compact"
          hide-details="auto"
        />
        <v-select
          v-model="form.address_source"
          label="Address source"
          :items="sources"
          :disabled="blocked"
          density="compact"
          hide-details="auto"
        />
        <v-switch
          v-model="form.enabled"
          label="Enabled"
          :disabled="blocked"
          density="compact"
          hide-details
          color="primary"
        />
        <v-text-field
          v-model="form.zone_resource_id"
          class="ddns-wide"
          label="Azure DNS zone resource ID"
          :disabled="blocked"
          density="compact"
          hide-details="auto"
        />
        <v-text-field
          v-model="form.record_name"
          label="Record name (@ for the zone apex)"
          :disabled="blocked"
          density="compact"
          hide-details="auto"
        />
        <v-number-input
          v-model="form.ttl_seconds"
          label="TTL (seconds)"
          :min="30"
          :max="86400"
          :disabled="blocked"
          density="compact"
          hide-details="auto"
          control-variant="stacked"
        />
        <v-number-input
          v-model="form.interval_seconds"
          label="Check interval (seconds)"
          :min="60"
          :max="86400"
          :disabled="blocked"
          density="compact"
          hide-details="auto"
          control-variant="stacked"
        />
        <v-text-field
          v-model="form.tenant_id"
          label="Tenant ID"
          :disabled="blocked"
          density="compact"
          hide-details="auto"
        />
        <v-text-field
          v-model="form.client_id"
          label="Client ID"
          :disabled="blocked"
          density="compact"
          hide-details="auto"
        />
        <v-text-field
          v-model="secret"
          label="Client secret"
          type="password"
          autocomplete="new-password"
          :disabled="blocked"
          density="compact"
          hide-details="auto"
          :hint="form.secret_ref ? 'Leave blank to keep the stored secret.' : 'Required for a new entry.'"
          persistent-hint
        />
      </div>
      <p class="setting-desc mt-2">
        Upload the secret over HTTPS or a trusted management channel. The appliance stores it privately but unencrypted, and discarded uploads still use its 256-secret capacity.
      </p>
      <div class="d-flex justify-end ga-2 mt-4">
        <v-btn
          variant="text"
          @click="close"
        >
          Cancel
        </v-btn>
        <v-btn
          type="submit"
          color="primary"
          prepend-icon="mdi-content-save-outline"
          :disabled="blocked"
          :loading="saving"
        >
          Save
        </v-btn>
      </div>
    </form>
  </section>
</template>

<style scoped>
section { padding-bottom: 56px; }
.ddns-table :deep(th), .ddns-table :deep(td) { white-space: normal; overflow-wrap: anywhere; }
.ddns-table :deep(.column-actions) { width: 96px; }
.ddns-form { margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border-light); }
.ddns-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 16px; max-width: 900px; }
.ddns-wide { grid-column: 1 / -1; }
.setting-desc { margin: 0; max-width: 760px; font-size: .8125rem; line-height: 1.45; color: var(--text-muted); }
@media (max-width: 700px) {
  .ddns-grid { grid-template-columns: 1fr; }
}
</style>
