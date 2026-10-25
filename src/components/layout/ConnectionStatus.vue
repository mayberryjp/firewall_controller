<script setup lang="ts">
import { computed } from "vue";
import { useControllerStore } from "@/stores/controller";
const store = useControllerStore();
const revisionLabel = computed(() => `Committed revision ${store.state.data?.revision ?? 'Unknown'}`);
const hasChanges = computed(() => store.editorDirty || store.diff.length > 0);
const changesLabel = computed(() => store.editorDirty ? "Unstaged form input; stage the current form before saving" : `Review and save configuration: ${store.diff.length} changed entities${store.validation.length ? `; ${store.validation.length} validation issues` : ''}`);
</script>

<template>
  <div
    class="navbar-status d-flex align-center"
    role="group"
    aria-label="Firewall status"
  >
    <v-btn
      v-if="store.connected"
      v-tooltip:bottom="revisionLabel"
      :to="store.state.data ? '/config' : undefined"
      :aria-label="revisionLabel"
      :disabled="!store.state.data || store.editorDirty"
      prepend-icon="mdi-file-cog-outline"
      size="small"
      variant="text"
    >
      Config r{{ store.state.data?.revision ?? "?" }}
    </v-btn>
    <v-btn
      v-if="store.connected && hasChanges"
      v-tooltip:bottom="changesLabel"
      aria-label="Save configuration"
      to="/config/changes"
      prepend-icon="mdi-content-save-outline"
      color="warning"
      size="small"
      variant="text"
      :disabled="store.busy || store.editorDirty"
    >
      Save
    </v-btn>
  </div>
</template>