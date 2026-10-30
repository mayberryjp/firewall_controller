<script setup lang="ts">
import type { FirewallCounterSummary } from "@/services/firewallTelemetry";
import FirewallCounterCells from "@/components/feature/FirewallCounterCells.vue";
import RuleOriginLabel from "@/components/feature/RuleOriginLabel.vue";
defineProps<{ rows: FirewallCounterSummary[]; columns: number }>();
</script>
<template>
  <tr
    v-for="row in rows"
    :key="row.id"
    class="counter-summary"
  >
    <td
      :colspan="columns - 2"
      class="counter-summary-label"
    >
      {{ row.label }}
      <RuleOriginLabel
        :rule="row"
        class="ml-2"
      />
    </td>
    <FirewallCounterCells :counts="row" />
  </tr>
</template>
<style scoped>
.counter-summary-label { color: rgb(var(--v-theme-on-surface)); }
@container (max-width: 860px) {
  .counter-summary-label { grid-column: 1 / -1; }
}
</style>
