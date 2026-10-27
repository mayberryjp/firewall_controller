<script setup lang="ts">
import type { DHCPRelayStatus } from "@/types/domain";
import { formatTimestamp } from "@/services/timestamps";
import ServiceWorkerStatus from "@/components/feature/ServiceWorkerStatus.vue";
defineProps<{ status?: DHCPRelayStatus }>();
</script>
<template>
  <span :title="status ? [status.pid ? `PID ${status.pid}` : '', status.started_at ? `Started ${formatTimestamp(status.started_at)} UTC` : ''].filter(Boolean).join(' · ') : undefined">
    <ServiceWorkerStatus :status="status" />
  </span>
</template>
