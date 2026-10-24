<script setup lang="ts">
import type { Dataset } from "@/stores/controller";
defineProps<{ query: Dataset<unknown>; label: string }>();
</script>

<template>
  <v-progress-linear
    v-if="query.loading && !query.data"
    indeterminate
    color="primary"
    class="mb-3"
  />
  <p
    v-if="query.delayed"
    role="status"
    class="text-warning mb-3"
  >
    Loading {{ label.toLowerCase() }} is taking longer than usual.
  </p>
  <v-alert
    v-if="query.error"
    :type="query.incompatible ? 'error' : 'warning'"
    variant="tonal"
    class="mb-4"
  >
    {{ label }}: {{ query.error }}
    <div v-if="query.lastSuccess">
      Showing previously loaded data.
    </div>
  </v-alert>
  <p
    v-else-if="query.stale && query.lastSuccess"
    class="text-caption text-medium-emphasis mb-3"
    :title="`Last read ${new Date(query.lastSuccess).toLocaleString()}`"
  >
    {{ label }}: stale data
  </p>
</template>
