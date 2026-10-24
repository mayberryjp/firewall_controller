<script setup lang="ts">
import { useControllerStore } from "@/stores/controller";
import type { Section } from "@/services/resourceForms";
import DatasetStatus from "@/components/base/DatasetStatus.vue";
import ServiceRepair from "@/components/feature/ServiceRepair.vue";
import GatewayStatisticsPanel from "@/components/feature/GatewayStatisticsPanel.vue";
defineProps<{ section: Section }>();
const store = useControllerStore();
</script>

<template>
  <template v-if="section === 'gateway_monitors'">
    <ServiceRepair service="gateway-monitoring" />
    <GatewayStatisticsPanel />
  </template>
  <template v-if="section === 'interfaces' || section === 'softflowd'">
    <DatasetStatus
      :query="store.runtime"
      :label="section === 'interfaces' ? 'Interface / relay runtime' : 'Service runtime'"
    />
    <v-alert
      v-if="store.runtime.data?.error"
      :type="section === 'interfaces' ? 'error' : 'warning'"
      class="mb-4"
    >
      {{ store.runtime.data.error }}
    </v-alert>
    <ServiceRepair
      v-if="section === 'softflowd'"
      service="softflowd"
    />
  </template>
</template>