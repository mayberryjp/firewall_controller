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
      v-tooltip:bottom="`${revisionLabel}; ${changesLabel}`"
      aria-label="Save configuration"
      :to="store.state.data ? '/config/changes' : undefined"
      prepend-icon="mdi-content-save-outline"
      :color="hasChanges ? 'warning' : undefined"
      size="small"
      variant="text"
      :disabled="!store.state.data || store.busy || store.editorDirty"
    >
      {{ hasChanges ? "SAVE " : "" }}R{{ store.state.data?.revision ?? "?" }}
    </v-btn>
  </div>
</template>