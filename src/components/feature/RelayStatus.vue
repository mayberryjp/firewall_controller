<script setup lang="ts">
import type { DHCPRelayStatus } from "@/types/domain";
import { formatTimestamp } from "@/services/timestamps";
defineProps<{ status?: DHCPRelayStatus }>();
const labels: Record<string, string> = {
  disabled: "Disabled", simulated: "Simulated", unavailable: "Unavailable",
  not_running: "Not running", running: "Running",
  unhealthy: "Unhealthy", exited: "Exited",
};
</script>
<template>
  <span :title="status ? [status.pid ? `PID ${status.pid}` : '', status.started_at ? `Started ${formatTimestamp(status.started_at)} UTC` : ''].filter(Boolean).join(' · ') : undefined">
    {{ status ? labels[status.state] ?? `Unknown (${status.state})` : "Unknown" }}
    <span
      v-if="status?.error"
      role="alert"
    > · {{ status.error }}</span>
  </span>
</template>
