<script setup lang="ts">
import { useControllerStore } from "@/stores/controller";
import type { Section } from "@/services/resourceForms";
import DatasetStatus from "@/components/base/DatasetStatus.vue";
import GatewayStatisticsPanel from "@/components/feature/GatewayStatisticsPanel.vue";
defineProps<{ section: Section }>();
const store = useControllerStore();
</script>

<template>
  <template v-if="section === 'gateway_monitors'">
    <GatewayStatisticsPanel status-only />
  </template>
  <template v-if="section === 'interfaces' || section === 'softflowd'">
    <DatasetStatus
      :query="store.runtime"
      :label="section === 'interfaces' ? 'Interface / relay runtime' : 'Service runtime'"
    />
  </template>
</template>