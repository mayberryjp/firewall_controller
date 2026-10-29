<script setup lang="ts">
import { useConfigExport } from "@/composables/useConfigExport";
import { useControllerStore } from "@/stores/controller";

const store = useControllerStore();
const { exportError, downloading, downloadCommittedConfig } = useConfigExport();
</script>

<template>
  <section aria-label="Download config">
    <v-btn
      prepend-icon="mdi-download"
      :loading="downloading"
      :disabled="!store.connected || downloading"
      @click="downloadCommittedConfig"
    >
      Download committed configuration
    </v-btn>
    <v-alert
      v-if="exportError"
      type="error"
      class="mt-4"
    >
      {{ exportError }}
    </v-alert>
  </section>
</template>