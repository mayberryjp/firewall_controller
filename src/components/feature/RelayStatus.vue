<script setup lang="ts">
import type { DHCPRelayStatus } from "@/types/domain";
defineProps<{ status?: DHCPRelayStatus }>();
const labels: Record<string, string> = {
  disabled: "Disabled", simulated: "Simulated; no real relay activity", unavailable: "Unavailable",
  not_running: "Not running", running: "Running; local readiness only, lease delivery not verified",
  unhealthy: "Unhealthy", exited: "Exited",
};
</script>
<template>
  <span>
    {{ status ? labels[status.state] ?? `Unknown (${status.state})` : "Unknown (no runtime data)" }}
    <template v-if="status?.pid"> · PID {{ status.pid }}</template>
    <template v-if="status?.started_at"> · Started {{ status.started_at }}</template>
    <span
      v-if="status?.error"
      role="alert"
    > · {{ status.error }}</span>
  </span>
</template>
