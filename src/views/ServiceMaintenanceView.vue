<script setup lang="ts">
import ServiceRepair from "@/components/feature/ServiceRepair.vue";
import SystemUpgrade from "@/components/feature/SystemUpgrade.vue";
</script>

<template>
  <section aria-label="Service maintenance">
    <ServiceRepair service="softflowd" />
    <SystemUpgrade />
  </section>
</template>