<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { useControllerStore } from "@/stores/controller";
import OverviewInterfaces from "@/components/feature/OverviewInterfaces.vue";
import OverviewCounters from "@/components/feature/OverviewCounters.vue";
import OverviewGateways from "@/components/feature/OverviewGateways.vue";
import OverviewWireGuard from "@/components/feature/OverviewWireGuard.vue";
const store = useControllerStore();
onMounted(() => {
  store.gatewayMonitoring = true;
  void store.refreshStatistics();
  void store.refreshGatewayStatistics();
});
onUnmounted(() => { store.gatewayMonitoring = false; });
</script>

<template>
  <section aria-labelledby="overview-title">
    <h1
      id="overview-title"
      class="text-h4 mb-4"
    >
      Overview
    </h1>
    <div class="overview-dashboard">
      <div class="overview-column">
        <OverviewInterfaces />
        <OverviewGateways />
        <OverviewWireGuard />
      </div>
      <OverviewCounters />
    </div>
  </section>
</template>

<style scoped>
.overview-dashboard {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  align-items: start;
}
.overview-column {
  display: grid;
  gap: 16px;
  min-width: 0;
}
@media (max-width: 959px) {
  .overview-dashboard {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
