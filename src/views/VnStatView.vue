<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { useControllerStore } from "@/stores/controller";
import { isApplianceStatus, vnstatSchema } from "@/types/domain";
import { cloneConfig, stableJson, validateConfig } from "@/services/configuration";
import DatasetStatus from "@/components/base/DatasetStatus.vue";

const store = useControllerStore();
const selected = computed(() => store.draft ?? store.state.data?.active_transaction?.candidate ?? store.state.data?.desired);
const settings = computed(() => selected.value?.vnstat);
const reportError = computed(() => store.runtime.data?.appliance_services.filter(isApplianceStatus).find(item => item.name === "vnstat")?.last_report_error);
const hasRow = computed(() => Boolean(settings.value?.enabled || settings.value?.collector));
const blocked = computed(() => Boolean(store.readOnlyReason) || !selected.value);
const editing = ref(false), creating = ref(false), collector = ref(""), initial = ref(""), snapshot = ref(""), error = ref("");
watch(collector, () => { if (editing.value) store.editorDirty = collector.value !== initial.value; }, { flush: "sync" });
onUnmounted(() => { store.editorDirty = false; });
function open(): void {
  creating.value = !hasRow.value;
  collector.value = settings.value?.collector ?? "";
  initial.value = collector.value; snapshot.value = stableJson(settings.value);
  error.value = ""; editing.value = true; store.editorDirty = false;
}
function cancel(): void { editing.value = false; store.editorDirty = false; error.value = ""; }
function commit(value: unknown): void {
  if (blocked.value || !selected.value) throw new Error(store.readOnlyReason || "Committed configuration is unavailable");
  const candidate = cloneConfig(selected.value);
  candidate.vnstat = vnstatSchema.parse(value);
  const issues = validateConfig(candidate).filter(issue => issue.path.startsWith("vnstat."));
  if (issues.length) throw new Error(issues.map(issue => issue.message).join(". "));
  store.stage(candidate);
}
function save(): void {
  error.value = "";
  try {
    if (snapshot.value !== stableJson(settings.value)) throw new Error("vnStat settings changed. Cancel and reopen the editor.");
    const destination = collector.value.trim();
    if (creating.value && !destination) throw new Error("Enter a collector IP:port; bracket IPv6.");
    commit({ ...settings.value, collector: destination || null });
    cancel();
  } catch (failure) { error.value = failure instanceof Error ? failure.message : "Unable to stage collector"; }
}
function toggle(enabled: boolean): void {
  error.value = "";
  try { commit({ ...settings.value, enabled }); }
  catch (failure) { error.value = failure instanceof Error ? failure.message : "Unable to stage vnStat"; }
}
function remove(): void {
  error.value = "";
  try { commit({ ...settings.value, enabled: false, collector: null }); }
  catch (failure) { error.value = failure instanceof Error ? failure.message : "Unable to remove collector"; }
}
</script>

<template>
  <section aria-label="vnStat">
    <DatasetStatus
      :query="store.state"
      label="Committed configuration"
    />
    <v-btn
      class="mb-4"
      prepend-icon="mdi-plus"
      color="primary"
      :disabled="blocked || hasRow || editing"
      @click="open"
    >
      Add collector
    </v-btn>
    <p
      v-if="error"
      role="alert"
      class="text-error mb-3"
    >
      {{ error }}
    </p>
    <v-table class="collector-table">
      <thead><tr><th>Collector</th><th>Enabled</th><th>Actions</th></tr></thead>
      <tbody>
        <tr
          v-if="editing"
          aria-label="Collector editor"
        >
          <td>
            <v-text-field
              v-model="collector"
              aria-label="Collector"
              placeholder="192.0.2.10:9999"
              density="compact"
              hide-details
              :disabled="blocked"
              @keydown.enter.prevent="save"
            />
          </td>
          <td />
          <td class="actions">
            <v-btn
              size="small"
              color="primary"
              :disabled="blocked"
              @click="save"
            >
              Save
            </v-btn>
            <v-btn
              size="small"
              variant="text"
              @click="cancel"
            >
              Cancel
            </v-btn>
          </td>
        </tr>
        <tr v-else-if="hasRow">
          <td>{{ settings?.collector ?? "Accounting only" }}</td>
          <td>
            <v-switch
              :model-value="settings?.enabled"
              aria-label="Enable vnStat"
              color="primary"
              density="compact"
              hide-details
              :disabled="blocked"
              @update:model-value="toggle(Boolean($event))"
            />
          </td>
          <td class="actions">
            <v-btn
              icon="mdi-pencil-outline"
              aria-label="Edit collector"
              title="Edit collector"
              size="x-small"
              variant="text"
              :disabled="blocked"
              @click="open"
            />
            <v-btn
              icon="mdi-delete-outline"
              aria-label="Delete collector"
              title="Delete collector"
              size="x-small"
              variant="text"
              color="error"
              :disabled="blocked"
              @click="remove"
            />
          </td>
        </tr>
        <tr v-else>
          <td colspan="3">
            No collectors.
          </td>
        </tr>
      </tbody>
    </v-table>
    <p
      v-if="reportError"
      role="status"
      class="text-warning mt-3"
    >
      {{ reportError }}
    </p>
  </section>
</template>

<style scoped>
.collector-table :deep(th), .collector-table :deep(td) { padding: 2px 6px; }
.collector-table :deep(.v-text-field) { min-width: 180px; }
.collector-table :deep(td) { vertical-align: middle; }
.actions { white-space: nowrap; }
@media (max-width: 600px) {
  .collector-table :deep(thead) { display: none; }
  .collector-table :deep(tbody tr) { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; padding: 8px 0; }
  .collector-table :deep(td:first-child) { grid-column: 1 / -1; overflow-wrap: anywhere; }
  .collector-table :deep(.v-text-field) { min-width: 0; }
}
</style>