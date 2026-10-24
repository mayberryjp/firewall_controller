<script setup lang="ts">
import { useControllerStore } from "@/stores/controller";
const store = useControllerStore();
defineEmits<{ disconnect: [] }>();
const deployment = import.meta.env.VITE_DEPLOYMENT_LABEL || "Unknown";
const mode = import.meta.env.VITE_BACKEND_MODE || "Unknown";
</script>

<template>
  <v-menu
    location="bottom end"
    :offset="8"
  >
    <template #activator="{ props }">
      <v-btn
        v-bind="props"
        icon
        class="ml-1 ml-lg-2"
        aria-label="Profile"
        title="Profile"
      >
        <v-avatar
          color="burgundy"
          size="36"
        >
          <v-icon icon="mdi-account" />
        </v-avatar>
      </v-btn>
    </template>
    <v-list
      class="navigation-menu"
      aria-label="Registry session"
    >
      <v-list-item :title="store.connected ? 'Connected' : 'Disconnected'" />
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