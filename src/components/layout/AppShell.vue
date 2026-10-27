<script setup lang="ts">
import { ref } from "vue";
import AppHeader from "@/components/layout/AppHeader.vue";
import DisconnectDialog from "@/components/layout/DisconnectDialog.vue";
import ConnectionBubble from "@/components/layout/ConnectionBubble.vue";
const disconnectDialog = ref(false);
</script>
<template>
  <v-app>
    <a
      class="skip-link"
      href="#main-content"
    >Skip to main content</a>
    <AppHeader />
    <v-main
      id="main-content"
      tabindex="-1"
    >
      <div class="app-content">
        <slot />
      </div>
    </v-main>
    <ConnectionBubble @disconnect="disconnectDialog = true" />
    <DisconnectDialog v-model="disconnectDialog" />
  </v-app>
</template>
