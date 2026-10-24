<script setup lang="ts">
import { ref } from "vue";
import { useControllerStore } from "@/stores/controller";
import AppHeader from "@/components/layout/AppHeader.vue";
import SafetyBanner from "@/components/layout/SafetyBanner.vue";
import DisconnectDialog from "@/components/layout/DisconnectDialog.vue";
const store = useControllerStore();
const disconnectDialog = ref(false);
</script>
<template>
  <v-app>
    <a
      class="skip-link"
      href="#main-content"
    >Skip to main content</a>
    <AppHeader @disconnect="disconnectDialog = true" />
    <v-main
      id="main-content"
      tabindex="-1"
    >
      <div class="app-content">
        <SafetyBanner v-if="store.connected" />
        <slot />
      </div>
    </v-main>
    <DisconnectDialog v-model="disconnectDialog" />
  </v-app>
</template>
