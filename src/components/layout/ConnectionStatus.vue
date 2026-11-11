<script setup lang="ts">
import { computed } from "vue";
import { useControllerStore } from "@/stores/controller";
const store = useControllerStore();
const revisionLabel = computed(() => `Committed revision ${store.state.data?.revision ?? 'Unknown'}`);
const netcontrolVersion = computed(() => store.state.data?.desired.software?.version);
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
      :color="hasChanges ? 'warning' : undefined"
      size="small"
      height="40"
      variant="text"
      :disabled="!store.state.data || store.busy || store.editorDirty"
    >
      <template #prepend>
        <svg
          class="save-icon"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          width="24"
          height="24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M5 3h12l4 4v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
          <path d="M7 3v6h9V3M7 21v-7h10v7" />
        </svg>
      </template>
      <span class="configuration-versions">
        <span
          class="config-revision"
          :class="{ 'config-pending': hasChanges }"
        >
          R{{ store.state.data?.revision ?? "?" }}
        </span>
        <span
          v-if="netcontrolVersion"
          class="netcontrol-version text-medium-emphasis"
        >
          netcontrol {{ netcontrolVersion }}
        </span>
      </span>
    </v-btn>
  </div>
</template>

<style scoped>
.configuration-versions {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  white-space: nowrap;
  line-height: 16px;
}
.netcontrol-version {
  font-size: 10px;
  line-height: 12px;
  letter-spacing: 0;
  text-transform: none;
}
.config-pending {
  animation: config-pending-pulse 4s ease-in-out infinite;
}

@keyframes config-pending-pulse {
  0%, 100% { color: rgb(var(--v-theme-warning)); }
  50% { color: #ffeb3b; }
}

@media (prefers-reduced-motion: reduce) {
  .config-pending {
    animation: none;
  }
}
</style>