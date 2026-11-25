<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useControllerStore } from "@/stores/controller";
import { cloneConfig } from "@/services/configuration";
import { sandoBaseUrl, getSandoStatus } from "@/services/sando";
import { sandoSchema, type SandoSettings } from "@/services/sandoState";
import { useDiagnosticRead } from "@/composables/useDiagnosticRead";
import { useTimestamps } from "@/composables/useTimestamps";

const store = useControllerStore();
const { formatTimestamp, timeZone } = useTimestamps();
const endpoint = ref(""), savedEndpoint = ref("");
const syncToggleVersion = ref(0);
const error = ref(""), notice = ref("");
const config = computed(() => store.draft ?? store.state.data?.desired);
const settingsBlocked = computed(() => store.readOnlyReason ||
  (!store.state.data?.desired.sando ? "This backend does not support saved Sando settings. Update the appliance backend first." : ""));
const blockedNotice = computed(() => store.connecting && !store.connected ? "" :
  store.readOnlyNotice || (store.state.data ? settingsBlocked.value : store.state.error ?? ""));
const { data: status, loading, error: statusError, stale } = useDiagnosticRead(
  getSandoStatus, 30_000, () => store.state.data?.desired.sando?.api_url ?? "",
  () => Boolean(store.state.data?.desired.sando),
);
watch(() => config.value?.sando?.api_url ?? "", value => {
  if (endpoint.value === savedEndpoint.value) endpoint.value = value;
  savedEndpoint.value = value;
}, { immediate: true });
watch([endpoint, savedEndpoint], () => { store.editorDirty = endpoint.value !== savedEndpoint.value; });
function stageSettings(update: Partial<Pick<SandoSettings, "api_url" | "sync_enabled" | "policy_sync_enabled">>): void {
  if (settingsBlocked.value || !config.value) throw new Error(settingsBlocked.value || "Configuration unavailable.");
  const candidate = cloneConfig(config.value);
  candidate.sando = sandoSchema.parse({ ...candidate.sando, ...update });
  store.stage(candidate);
}
function setSync(key: "sync_enabled" | "policy_sync_enabled", enabled: boolean | null): void {
  error.value = ""; notice.value = "";
  try {
    if (typeof enabled !== "boolean") throw new Error("Choose enabled or disabled for automatic sync.");
    stageSettings({ [key]: enabled });
  } catch (cause) {
    syncToggleVersion.value++;
    error.value = `Unable to change automatic Sando sync: ${cause instanceof Error ? cause.message : "configuration unavailable"}`;
  }
}
function saveEndpoint(): void {
  error.value = ""; notice.value = "";
  try {
    const normalized = endpoint.value.trim() ? sandoBaseUrl(endpoint.value) : "";
    stageSettings({ api_url: normalized });
    endpoint.value = normalized; savedEndpoint.value = normalized; store.editorDirty = false;
    notice.value = "Endpoint staged.";
  } catch (cause) {
    error.value = `Unable to save Sando endpoint: ${cause instanceof Error ? cause.message : "configuration unavailable"}`;
  }
}
watch(() => store.sessionVersion, () => {
  endpoint.value = savedEndpoint.value;
  error.value = ""; notice.value = ""; store.editorDirty = false;
});
onBeforeUnmount(() => { store.editorDirty = false; });
</script>

<template>
  <section aria-label="SANDO IMPORT">
    <h1 class="text-h5 mb-4">
      SANDO IMPORT
    </h1>
    <v-alert
      v-if="blockedNotice"
      type="warning"
      variant="tonal"
      class="mb-4"
    >
      {{ blockedNotice }}
    </v-alert>
    <v-alert
      v-if="error"
      type="error"
      class="mb-4"
      style="white-space: pre-wrap"
    >
      {{ error }}
    </v-alert>
    <v-alert
      v-if="statusError"
      type="error"
      class="mb-4"
    >
      Unable to read server-side Sando sync status: {{ statusError }}<template v-if="stale">
        Previously loaded sync timestamps are stale.
      </template>
    </v-alert>
    <v-alert
      v-if="notice"
      type="success"
      variant="tonal"
      class="mb-4"
    >
      {{ notice }}
    </v-alert>
    <v-text-field
      v-model="endpoint"
      label="Sando API endpoint"
      placeholder="https://sando.example/api"
      hide-details="auto"
      :disabled="Boolean(settingsBlocked)"
      class="mb-4"
    />
    <v-btn
      :disabled="Boolean(settingsBlocked)"
      class="mb-4"
      @click="saveEndpoint"
    >
      Save endpoint
    </v-btn>
    <div
      v-if="loading && !status"
      role="status"
      class="mb-4"
    >
      Loading server-side sync status...
    </div>
    <div class="d-flex align-center flex-wrap ga-3 mb-4">
      <v-switch
        :key="String(config?.sando?.sync_enabled ?? false) + syncToggleVersion"
        :model-value="config?.sando?.sync_enabled ?? false"
        label="Automatic host and threat-score sync"
        :disabled="Boolean(settingsBlocked)"
        color="primary"
        hide-details
        class="flex-grow-0"
        @update:model-value="setSync('sync_enabled', $event)"
      />
      <v-chip
        v-if="status"
        size="small"
        variant="tonal"
        aria-label="Last successful host sync"
      >
        Last successful host sync ({{ timeZone }}): {{ formatTimestamp(status.last_success_at, "No successful sync yet") }}
      </v-chip>
    </div>
    <v-alert
      v-if="status?.error"
      type="error"
      variant="tonal"
      class="mb-4"
    >
      Host sync failed: {{ status.error }}
    </v-alert>
    <div class="d-flex align-center flex-wrap ga-3 mb-4">
      <v-switch
        :key="'policies-' + String(config?.sando?.policy_sync_enabled ?? false) + syncToggleVersion"
        :model-value="config?.sando?.policy_sync_enabled ?? false"
        label="Automatically sync policies"
        :disabled="Boolean(settingsBlocked)"
        color="primary"
        hide-details
        class="flex-grow-0"
        @update:model-value="setSync('policy_sync_enabled', $event)"
      />
      <v-chip
        v-if="status"
        size="small"
        variant="tonal"
        aria-label="Last successful policy sync"
      >
        Last successful policy sync ({{ timeZone }}): {{ formatTimestamp(status.policies.last_success_at, "No successful sync yet") }}
      </v-chip>
    </div>
    <v-alert
      v-if="status?.policies.error"
      type="error"
      variant="tonal"
      class="mb-4"
    >
      Policy sync failed: {{ status.policies.error }}
    </v-alert>
  </section>
</template>
