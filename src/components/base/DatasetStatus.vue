<script setup lang="ts">
import type { Dataset } from "@/stores/controller";
defineProps<{ query: Dataset<unknown>; label: string }>();
</script>

<template>
  <v-progress-linear
    v-if="query.loading"
    indeterminate
    color="primary"
    class="mb-3"
  />
  <p
    v-if="query.delayed"
    role="status"
    class="text-warning mb-3"
  >
    Read delayed; the engine may be busy. No duplicate request is queued.
  </p>
  <v-alert
    v-if="query.error"
    :type="query.incompatible ? 'error' : 'warning'"
    variant="tonal"
    class="mb-4"
  >
    {{ label }}: {{ query.error }}
    <div v-if="query.lastSuccess">
      Last known result is stale, from {{ new Date(query.lastSuccess).toLocaleString() }}.
    </div>
  </v-alert>
  <p
    v-else-if="query.lastSuccess"
    class="text-caption text-medium-emphasis mb-3"
  >
    {{ label }} · {{ query.stale ? "Stale" : "Last successful read" }} {{ new Date(query.lastSuccess).toLocaleString() }}
  </p>
  <p
    v-else-if="!query.loading && !query.error"
    class="text-medium-emphasis mb-3"
  >
    {{ label }} not loaded.
  </p>
</template>
