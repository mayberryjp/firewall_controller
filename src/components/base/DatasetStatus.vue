<script setup lang="ts">
import type { Dataset } from "@/stores/controller";
import { useTimestamps } from "@/composables/useTimestamps";
const { formatTimestamp, timeZone } = useTimestamps();
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
  <p
    v-if="query.error"
    class="text-caption text-medium-emphasis mb-3"
    role="status"
  >
    {{ label }}: {{ query.error }}
    <span v-if="query.lastSuccess">
      Showing previously loaded data.
    </span>
  </p>
  <p
    v-else-if="query.stale && query.lastSuccess"
    class="text-caption text-medium-emphasis mb-3"
    :title="`Last read ${formatTimestamp(query.lastSuccess)} ${timeZone}`"
  >
    {{ label }}: stale data
  </p>
</template>
