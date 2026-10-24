<script setup lang="ts">
import { computed, ref } from "vue";
import { useControllerStore } from "@/stores/controller";
import ApplyConfigurationDialog from "@/components/feature/ApplyConfigurationDialog.vue";
const store = useControllerStore();
const saveDialog = ref(false), refreshing = ref(false);
const connectionLabel = computed(() => !store.connected ? "Disconnected" : store.state.error ? "Observation unavailable" : store.state.stale ? "Connected; committed state is stale" : "Connected");
const connectionColor = computed(() => !store.connected ? "error" : store.state.error || store.state.stale ? "warning" : "success");
const revisionLabel = computed(() => `Committed revision ${store.state.data?.revision ?? 'Unknown'}`);
const refreshLabel = computed(() => `Refresh firewall state. Last refresh ${store.state.lastSuccess ? new Date(store.state.lastSuccess).toLocaleString() : 'Unknown'}`);
const hasChanges = computed(() => store.editorDirty || store.diff.length > 0);
const changesLabel = computed(() => store.editorDirty ? "Unstaged form input; stage the current form before saving" : `Save configuration: ${store.diff.length} changed entities${store.validation.length ? `; ${store.validation.length} validation issues` : ''}`);
async function refresh(): Promise<void> {
  refreshing.value = true;
  try {
    await Promise.all([
      store.refresh(),
      ...(store.monitoring ? [store.refreshStatistics()] : []),
      ...(store.gatewayMonitoring ? [store.refreshGatewayStatistics()] : []),
    ]);
  } finally { refreshing.value = false; }
}
</script>

<template>
  <div
    class="navbar-status d-flex align-center"
    role="group"
    aria-label="Firewall status"
  >
    <v-icon
      v-tooltip:bottom="connectionLabel"
      :icon="store.connected ? 'mdi-lan-connect' : 'mdi-lan-disconnect'"
      :color="connectionColor"
      :aria-label="connectionLabel"
      :aria-hidden="false"
      :title="connectionLabel"
      role="img"
      size="22"
      class="mx-1"
    />
    <v-btn
      v-if="store.connected"
      v-tooltip:bottom="revisionLabel"
      :to="store.state.data ? `/history/${store.state.data.revision}` : undefined"
      :aria-label="revisionLabel"
      :title="revisionLabel"
      :disabled="!store.state.data || store.editorDirty"
      prepend-icon="mdi-file-cog-outline"
      size="small"
      variant="text"
    >
      Config r{{ store.state.data?.revision ?? "?" }}
    </v-btn>
    <v-btn
      v-if="store.connected"
      v-tooltip:bottom="refreshLabel"
      :title="refreshLabel"
      aria-label="Refresh firewall state"
      icon="mdi-refresh"
      size="x-small"
      variant="text"
      :disabled="store.busy || refreshing"
      :loading="refreshing || store.state.loading"
      @click="refresh"
    />
    <v-btn
      v-if="store.connected && hasChanges"
      v-tooltip:bottom="changesLabel"
      :title="changesLabel"
      aria-label="Save configuration"
      prepend-icon="mdi-content-save-outline"
      color="warning"
      size="small"
      variant="text"
      :disabled="store.busy"
      @click="saveDialog = true"
    >
      Save
    </v-btn>
  </div>
  <ApplyConfigurationDialog
    v-model="saveDialog"
    edit-options
  />
</template>