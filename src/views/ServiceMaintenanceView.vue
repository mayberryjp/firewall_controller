<script setup lang="ts">
import ServiceRepair from "@/components/feature/ServiceRepair.vue";
</script>

<template>
  <section aria-label="Service maintenance">
    <ServiceRepair service="softflowd" />
    <router-link to="/config/upgrade">
      Check for software upgrades in Config
    </router-link>
  </section>
</template>