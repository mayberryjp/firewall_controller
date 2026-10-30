<script setup lang="ts">
import type { FirewallCounts } from "@/services/firewallTelemetry";
defineProps<{ counts: FirewallCounts }>();
</script>
<template>
  <td class="firewall-counter-cell">
    <span class="counter-label">Packets</span>
    <span class="counter-value">{{ counts.packets }}</span>
  </td>
  <td class="firewall-counter-cell">
    <span class="counter-label">Bytes</span>
    <span class="counter-value">{{ counts.bytes }}</span>
  </td>
</template>
<style scoped>
.firewall-counter-cell { font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.counter-label { display: none; }
@container (max-width: 860px) {
  .counter-label { display: block; margin-bottom: 2px; color: rgba(var(--v-theme-on-surface), 0.6); font-size: 12px; }
}
</style>
