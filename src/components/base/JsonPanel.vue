<script setup lang="ts">
defineProps<{ value: unknown; label?: string }>();
</script>
<template>
  <details class="json-panel">
    <summary>{{ label || "Read-only JSON" }}</summary>
    <pre>{{ JSON.stringify(value, null, 2) }}</pre>
  </details>
</template>
