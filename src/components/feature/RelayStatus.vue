<script setup lang="ts">
import type { DHCPRelayStatus } from "@/types/domain";
import { useTimestamps } from "@/composables/useTimestamps";
import ServiceWorkerStatus from "@/components/feature/ServiceWorkerStatus.vue";
const { formatTimestamp, timeZone } = useTimestamps();
defineProps<{ status?: DHCPRelayStatus }>();
</script>
<template>
  <span :title="status ? [status.pid ? `PID ${status.pid}` : '', status.started_at ? `Started ${formatTimestamp(status.started_at)} ${timeZone}` : ''].filter(Boolean).join(' · ') : undefined">
    <ServiceWorkerStatus :status="status" />
  </span>
</template>
