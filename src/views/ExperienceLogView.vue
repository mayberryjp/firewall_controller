<script setup lang="ts">
import PersistentLogStream from "@/components/feature/PersistentLogStream.vue";
</script>

<template>
  <section aria-label="Experience log">
    <h1 class="text-h6 mb-4">
      EXPERIENCE LOG
    </h1>
    <p class="text-caption text-medium-emphasis mb-3">
      Probe timeouts are nonresponses, not proven user-packet loss. TCP evidence is router-local;
      diagnostic-capture drops indicate lost monitoring coverage, not network drops.
    </p>
    <PersistentLogStream
      source="performance"
      active
    />
  </section>
</template>
