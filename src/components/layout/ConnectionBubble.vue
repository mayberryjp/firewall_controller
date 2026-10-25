<script setup lang="ts">
import { computed } from "vue";
import { useControllerStore } from "@/stores/controller";
const store = useControllerStore();
defineEmits<{ disconnect: [] }>();
const deployment = import.meta.env.VITE_DEPLOYMENT_LABEL || "Unknown";
const mode = import.meta.env.VITE_BACKEND_MODE || "Unknown";
const readProblem = computed(() => [store.state, store.transactions].some(query =>
  Boolean(query.error) || (query.stale && query.lastSuccess !== null && !query.loading)));
const connectionLabel = computed(() => !store.connected ? "Offline" : store.incompatible ? "API mismatch" :
  store.state.error || store.transactions.error ? "Read failed" : readProblem.value ? "Stale" : "Connected");
const expanded = computed(() => connectionLabel.value !== "Connected");
const connectionColor = computed(() => !store.connected ? "error" : expanded.value ? "warning" : "success");
const connectionIcon = computed(() => !store.connected ? "mdi-lan-disconnect" : expanded.value ? "mdi-alert-circle-outline" : "mdi-lan-connect");
</script>

<template>
  <v-menu
    location="top end"
    :offset="8"
    max-width="360"
  >
    <template #activator="{ props }">
      <v-btn
        v-tooltip:top="connectionLabel"
        v-bind="props"
        class="connection-bubble"
        :class="{ 'connection-bubble--expanded': expanded }"
        :color="connectionColor"
        :aria-label="connectionLabel"
        :icon="expanded ? false : connectionIcon"
        :prepend-icon="expanded ? connectionIcon : undefined"
        variant="elevated"
        rounded="pill"
        :size="expanded ? 'default' : 40"
      >
        <v-icon
          v-if="!expanded"
          :icon="connectionIcon"
          aria-hidden="true"
        />
        <span v-else>{{ connectionLabel }}</span>
      </v-btn>
    </template>
    <v-list
      class="navigation-menu"
      aria-label="Registry session"
    >
      <v-list-item :title="connectionLabel" />
      <v-list-item
        v-if="store.authError"
        :title="store.authError"
        class="connection-diagnostic"
      />
      <v-list-item
        v-if="store.state.error"
        :title="store.state.error"
        class="connection-diagnostic"
      />
      <v-list-item
        v-if="store.transactions.error"
        :title="store.transactions.error"
        class="connection-diagnostic"
      />
      <v-list-item
        v-if="store.connected && readProblem"
        title="Retry"
        prepend-icon="mdi-refresh"
        :disabled="store.state.loading || store.transactions.loading"
        @click="store.refresh"
      />
      <v-list-item
        :title="`Deployment: ${deployment}`"
        :subtitle="`Mode: ${mode} (operator supplied)`"
      />
      <v-list-item
        v-if="store.connected"
        title="Disconnect"
        prepend-icon="mdi-logout"
        :disabled="store.busy"
        @click="$emit('disconnect')"
      />
    </v-list>
  </v-menu>
</template>

<style scoped>
.connection-bubble { height: 40px; }
.connection-bubble--expanded { min-width: 40px; max-width: calc(100vw - 40px); padding-inline: 12px; }
.connection-diagnostic :deep(.v-list-item-title) { white-space: normal; overflow-wrap: anywhere; }
</style>