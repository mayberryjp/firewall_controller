<script setup lang="ts">
import { computed } from "vue";
import type { Statistics } from "@/types/domain";
const props = defineProps<{ sample?: Statistics["interfaces"][number]; stale: boolean; simulated: boolean }>();
const status = computed(() => {
  if (props.stale || !props.sample || props.sample.error) return "Unknown";
  if (props.simulated || props.sample.status === "simulated") return "Simulated";
  if (props.sample.status !== "available") return "Unknown";
  if (!props.sample.admin_up) return "Down";
  if (props.sample.oper_state.toUpperCase() === "UP") return "Up";
  return ["DOWN", "LOWERLAYERDOWN", "NOTPRESENT"].includes(props.sample.oper_state.toUpperCase()) ? "Down" : "Unknown";
});
</script>

<template>
  <v-chip
    :color="status === 'Up' ? 'success' : status === 'Down' ? 'error' : 'default'"
    size="small"
    variant="tonal"
    :title="sample?.error || (stale ? 'Live interface sample unavailable or stale' : sample?.oper_state)"
  >
    {{ status }}
  </v-chip>
</template>