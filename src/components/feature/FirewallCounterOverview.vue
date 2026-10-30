<script setup lang="ts">
import { computed } from "vue";
import { useControllerStore } from "@/stores/controller";
import { useFirewallCounters } from "@/composables/useFirewallCounters";
import FirewallCounterRows from "@/components/feature/FirewallCounterRows.vue";

defineProps<{ chain: "forward" | "input" }>();
const store = useControllerStore();
const selected = computed(() => store.draft ?? store.state.data?.active_transaction?.candidate ?? store.state.data?.desired);
const counters = useFirewallCounters(selected);
</script>
<template>
  <v-table v-if="counters.summaries(chain).length">
    <thead><tr><th>Rule</th><th>Packets</th><th>Bytes</th></tr></thead>
    <tbody>
      <FirewallCounterRows
        :rows="counters.summaries(chain)"
        :columns="3"
      />
    </tbody>
  </v-table>
  <p class="text-caption text-medium-emphasis mt-2">
    {{ counters.notice.value }}
  </p>
</template>
