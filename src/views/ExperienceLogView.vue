<script setup lang="ts">
import PersistentLogStream from "@/components/feature/PersistentLogStream.vue";
</script>

<template>
  <section aria-label="Experience log">
    <h1 class="text-h6 mb-4">
      EXPERIENCE LOG
    </h1>
    <PersistentLogStream
      source="performance"
      active
    />
  </section>
</template>
