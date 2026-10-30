<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useControllerStore } from "@/stores/controller";
import { vnstatSchema } from "@/types/domain";
import { cloneConfig, stableJson, validateConfig } from "@/services/configuration";
import DatasetStatus from "@/components/base/DatasetStatus.vue";

const store = useControllerStore();
const selected = computed(() => store.draft ?? store.state.data?.active_transaction?.candidate ?? store.state.data?.desired);
const settings = computed(() => selected.value?.vnstat);
const reporting = computed(() => store.vnstatReporting.data);
const hasRow = computed(() => Boolean(settings.value?.enabled || settings.value?.collector));
const blocked = computed(() => Boolean(store.readOnlyReason) || !selected.value);
const editing = ref(false), creating = ref(false), collector = ref(""), initial = ref(""), snapshot = ref(""), error = ref("");
watch(collector, () => { if (editing.value) store.editorDirty = collector.value !== initial.value; }, { flush: "sync" });
onUnmounted(() => { store.editorDirty = false; });
onMounted(() => { void store.refreshVnStatReporting(); });
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
      <thead>
        <tr>
          <th scope="col">
            Collector
          </th>
          <th scope="col">
            Enabled
          </th>
          <th
            scope="col"
            title="Appliance-local date of the last reporting attempt, including failed sends; not confirmed delivery."
          >
            Last report
          </th>
          <th
            scope="col"
            title="Datagrams accepted by the local socket; UDP delivery is not confirmed."
          >
            Sent
          </th>
          <th scope="col">
            Failed
          </th>
          <th scope="col">
            Actions
          </th>
        </tr>
      </thead>
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
          <td
            colspan="3"
            class="reporting-placeholder"
          />
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
            <span class="compact-cell-label">Enabled</span>
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
          <td title="Appliance-local attempt date, including failed sends; not confirmed delivery.">
            <span class="compact-cell-label">Last report</span>
            <span class="report-value">{{ reporting ? reporting.last_report_date ?? 'No attempt recorded' : 'Unavailable' }}</span>
          </td>
          <td title="Datagrams accepted by the local socket; UDP delivery is not confirmed.">
            <span class="compact-cell-label">Sent</span>
            <span class="report-value">{{ reporting?.sent_datagrams ?? 'Unavailable' }}</span>
          </td>
          <td :title="reporting?.last_report_error ?? undefined">
            <span class="compact-cell-label">Failed</span>
            <span class="report-value">{{ reporting?.failed_datagrams ?? 'Unavailable' }}</span>
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
          <td colspan="6">
            No collectors.
          </td>
        </tr>
      </tbody>
    </v-table>
    <DatasetStatus
      :query="store.vnstatReporting"
      label="Daily reporting"
    />
    <p
      v-if="reporting?.last_report_error"
      role="status"
      class="text-warning mt-3"
    >
      {{ reporting.last_report_error }}
    </p>
  </section>
</template>

<style scoped>
.collector-table :deep(th), .collector-table :deep(td) { padding: 2px 6px; }
.collector-table :deep(.v-text-field) { min-width: 180px; }
.collector-table :deep(td) { vertical-align: middle; overflow-wrap: anywhere; }
.actions { white-space: nowrap; }
.compact-cell-label { display: none; }
@media (max-width: 600px) {
  .compact-cell-label { display: block; margin-bottom: 2px; color: rgba(var(--v-theme-on-surface), 0.6); font-size: 12px; }
  .collector-table :deep(thead) { display: none; }
  .collector-table :deep(tbody tr) { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; padding: 8px 0; }
  .collector-table :deep(.v-table__wrapper td) { height: auto; }
  .collector-table :deep(td:first-child) { grid-column: 1 / -1; overflow-wrap: anywhere; }
  .collector-table :deep(.v-text-field) { min-width: 0; }
  .collector-table :deep(.reporting-placeholder) { display: none; }
  .collector-table :deep(.actions) { grid-column: 1 / -1; text-align: right; }
}
</style>