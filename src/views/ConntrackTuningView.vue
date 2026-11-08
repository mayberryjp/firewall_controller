<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { useControllerStore } from "@/stores/controller";
import { cloneConfig, stableJson, validateConfig } from "@/services/configuration";
import { isInitialLoad } from "@/services/datasets";
import { conntrackControls, conntrackLabel, conntrackUnit, conntrackValueError, type KernelTunable } from "@/services/conntrack";

const store = useControllerStore();
const selected = computed(() => store.draft ?? store.state.data?.active_transaction?.candidate ?? store.state.data?.desired);
const controls = computed(() => conntrackControls(store.supportedKernelCatalog));
const values = ref<Record<string, string>>({}), initial = ref(""), snapshot = ref("");
const initialValues = ref<Record<string, string>>({});
const error = ref(""), notice = ref("");
const dirty = computed(() => stableJson(values.value) !== initial.value);
const changed = computed(() => stableJson(selected.value?.kernel) !== snapshot.value);
const loading = computed(() => store.kernelCatalog.loading || store.kernelTunables.loading ||
  isInitialLoad(store.kernelCatalog) || isInitialLoad(store.kernelTunables) || isInitialLoad(store.state));
const readError = computed(() => store.kernelCatalog.error || store.kernelTunables.error || store.state.error);
const blockedReason = computed(() => {
  if (loading.value || readError.value) return "";
  if (store.kernelCatalog.stale || store.kernelTunables.stale || store.state.stale) return "Conntrack or configuration data is stale. Reload settings before staging.";
  if (!controls.value.length) return "This backend does not support conntrack tuning. Deploy a supporting backend before staging changes.";
  if (store.draftStale) return "The draft base revision changed. Review the stale draft in SAVE before editing.";
  if (store.incompatible) return "Resolve incompatible configuration or transaction state before editing.";
  return store.readOnlyReason || store.operationBlockedReason;
});
const disabled = computed(() => loading.value || Boolean(readError.value || blockedReason.value) ||
  !store.connected || !selected.value || !store.kernelTunables.data || store.incompatible || store.draftStale || changed.value);
const scopes = ["host", "namespace"] as const;
const key = (entry: KernelTunable) => `${entry.scope}/${entry.name}`;
function systemValue(entry: KernelTunable): string | undefined {
  const current = store.kernelTunables.data;
  return current?.observed[entry.scope][entry.name] ?? current?.effective[entry.scope][entry.name];
}
function currentValueLabel(entry: KernelTunable): string {
  const current = systemValue(entry);
  if (current !== undefined) return `Current system: ${current} ${conntrackUnit(entry.name)}`;
  const configured = store.kernelTunables.data?.configured[entry.scope][entry.name];
  return configured !== undefined ? `Applied configuration: ${configured} ${conntrackUnit(entry.name)}` : "Current system value unavailable.";
}
function reset(): void {
  values.value = Object.fromEntries(controls.value.map(entry => [key(entry),
    selected.value?.kernel?.[entry.scope][entry.name] ?? systemValue(entry) ??
    store.kernelTunables.data?.configured[entry.scope][entry.name] ?? "",
  ]));
  initialValues.value = { ...values.value };
  initial.value = stableJson(values.value); snapshot.value = stableJson(selected.value?.kernel);
  error.value = ""; notice.value = ""; store.editorDirty = false;
}
watch(dirty, value => { store.editorDirty = value; }, { flush: "sync" });
watch([controls, () => stableJson(selected.value?.kernel), () => store.kernelTunables.data], () => { if (!dirty.value) reset(); }, { immediate: true, flush: "sync" });
watch(() => [store.connected, store.sessionVersion], () => {
  reset();
  if (store.connected) void read();
}, { immediate: true });
onUnmounted(() => { store.editorDirty = false; });
async function read(): Promise<void> {
  if (!store.connected) return;
  await Promise.all([store.refreshKernelCatalog(), store.refreshKernelTunables()]);
}
function fieldError(entry: KernelTunable): string {
  const value = values.value[key(entry)];
  if (value === initialValues.value[key(entry)]) return "";
  return value === "" ? "Enter a value. Conntrack settings remain managed by the firewall." : conntrackValueError(value, entry);
}
function stage(): void {
  error.value = ""; notice.value = "";
  try {
    if (disabled.value || !selected.value) throw new Error(readError.value || blockedReason.value || "Wait for current supported settings, or reset conflicting edits before staging.");
    const candidate = cloneConfig(selected.value);
    candidate.kernel ??= { host: {}, namespace: {} };
    for (const entry of controls.value) {
      const value = values.value[key(entry)];
      if (value === initialValues.value[key(entry)]) continue;
      const message = fieldError(entry);
      if (message) throw new Error(`${conntrackLabel(entry.name)}: ${message}`);
      if (typeof value !== "string") throw new Error("A string value is required.");
      candidate.kernel[entry.scope][entry.name] = value;
    }
    const issues = validateConfig(candidate, store.runtime.data?.parent_interfaces, store.baseline ?? store.state.data?.desired, store.supportedKernelCatalog)
      .filter(issue => issue.path.startsWith("kernel"));
    if (issues.length) throw new Error(issues.map(issue => issue.message).join("; "));
    store.stage(candidate); reset(); notice.value = "Conntrack changes staged. Review and apply them in SAVE.";
  } catch (failure) { error.value = failure instanceof Error ? failure.message : "Unable to stage conntrack changes."; }
}
</script>

<template>
  <section aria-label="Conntrack tuning">
    <h1 class="text-h6 mb-4">
      Conntrack tuning
    </h1>
    <p
      v-if="loading"
      role="status"
      class="mb-4"
    >
      Loading conntrack settings...
    </p>
    <v-alert
      v-if="readError"
      type="error"
      role="alert"
      class="mb-4"
    >
      Unable to read conntrack settings: {{ readError }}. Typed edits are retained.
    </v-alert>
    <v-alert
      v-if="blockedReason"
      type="warning"
      variant="tonal"
      class="mb-4"
    >
      {{ blockedReason }}
    </v-alert>
    <v-alert
      v-if="dirty && changed"
      type="warning"
      class="mb-4"
    >
      Kernel settings changed while editing. Copy your edits, then reset and merge into the latest configuration.
    </v-alert>
    <form @submit.prevent="stage">
      <template
        v-for="scope in scopes"
        :key="scope"
      >
        <template
          v-for="entry in controls.filter(entry => entry.scope === scope)"
          :key="key(entry)"
        >
          <div
            class="setting-row"
            :data-tunable="entry.name"
          >
            <label
              :for="`conntrack-${key(entry)}`"
              class="setting-name"
            >
              {{ conntrackLabel(entry.name) }} ({{ conntrackUnit(entry.name) }})
            </label>
            <div class="setting-control">
              <v-text-field
                :id="`conntrack-${key(entry)}`"
                v-model="values[key(entry)]"
                :aria-label="`${conntrackLabel(entry.name)} (${conntrackUnit(entry.name)})`"
                :aria-describedby="`conntrack-${key(entry)}-description`"
                inputmode="numeric"
                placeholder="Enter a value"
                density="compact"
                :disabled="disabled"
                :error-messages="fieldError(entry)"
                :hide-details="!fieldError(entry)"
                class="setting-field"
                @update:model-value="notice = ''; error = ''"
              />
              <p
                :id="`conntrack-${key(entry)}-description`"
                class="setting-desc"
              >
                {{ entry.min }}..{{ entry.max }} {{ conntrackUnit(entry.name) }}. {{ entry.description }}
              </p>
              <p
                v-if="!loading && !readError"
                class="setting-desc conntrack-current"
              >
                {{ currentValueLabel(entry) }}
              </p>
            </div>
          </div>
          <v-divider />
        </template>
      </template>
      <v-alert
        v-if="error"
        type="error"
        role="alert"
        class="mb-4"
      >
        {{ error }}
      </v-alert>
      <p
        v-if="notice"
        role="status"
        class="mb-4"
      >
        {{ notice }}
      </p>
      <div class="d-flex flex-wrap justify-end ga-2 mt-6">
        <v-btn
          :disabled="!dirty"
          @click="reset"
        >
          Reset edits
        </v-btn>
        <v-btn
          v-if="readError || blockedReason"
          :disabled="!store.connected || store.kernelCatalog.loading || store.kernelTunables.loading"
          @click="read"
        >
          Reload settings
        </v-btn>
        <v-btn
          type="submit"
          prepend-icon="mdi-content-save-outline"
          color="primary"
          :disabled="disabled || !dirty || controls.some(entry => Boolean(fieldError(entry)))"
        >
          Save
        </v-btn>
      </div>
    </form>
  </section>
</template>

<style scoped>
.setting-row { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 24px; align-items: start; padding: 18px 4px; }
.setting-name { padding-top: 6px; font-weight: 700; color: var(--text-primary); }
.setting-control { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; min-width: 0; }
.setting-field { width: 100%; max-width: 360px; }
.setting-desc { margin: 0; max-width: 760px; font-size: 0.8125rem; line-height: 1.45; color: var(--text-muted); }
.conntrack-current { font-variant-numeric: tabular-nums; }
@media (max-width: 700px) {
  .setting-row { grid-template-columns: 1fr; gap: 10px; padding: 16px 4px; }
  .setting-name { padding-top: 0; }
}
</style>
