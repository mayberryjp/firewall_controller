<script setup lang="ts">
import ResourcePage from "@/components/feature/ResourcePage.vue";
import GatewayRttChart from "@/components/feature/GatewayRttChart.vue";
</script>
<template>
  <GatewayRttChart />
  <ResourcePage section="gateway_monitors" />
</template>