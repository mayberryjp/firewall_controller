<script setup lang="ts">
import type { FirewallCounterSummary } from "@/services/firewallTelemetry";
import FirewallCounterCells from "@/components/feature/FirewallCounterCells.vue";
import RuleOriginLabel from "@/components/feature/RuleOriginLabel.vue";
import { RouterLink } from "vue-router";
import { formatInterfaceName } from "@/services/interfaceNames";
defineProps<{ rows: FirewallCounterSummary[]; columns: number; originColumn?: boolean }>();
</script>
<template>
  <tr
    v-for="row in rows"
    :key="row.id"
    class="counter-summary"
  >
    <td
      :colspan="columns - (originColumn ? 3 : 2)"
      class="counter-summary-label"
    >
      {{ row.label }}
      <RouterLink
        v-if="row.interfaceName"
        :to="{ name: 'interface-detail', params: { name: row.interfaceName } }"
        class="ml-2"
      >
        {{ formatInterfaceName(row.interfaceName) }}
      </RouterLink>
      <RuleOriginLabel
        v-if="!originColumn"
        :rule="row"
        class="ml-2"
      />
    </td>
    <td v-if="originColumn">
      <RuleOriginLabel :rule="row" />
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
