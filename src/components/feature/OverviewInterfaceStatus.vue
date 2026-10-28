<script setup lang="ts">
import { computed } from "vue";
import type { Statistics } from "@/types/domain";
const props = defineProps<{ sample?: Statistics["interfaces"][number]; stale: boolean; simulated: boolean; state: "admin" | "operational" }>();
const operationalLabels: Record<string, string> = {
  UP: "Up", DOWN: "Down", UNKNOWN: "-", LOWERLAYERDOWN: "Lower layer down",
  NOTPRESENT: "Not present", DORMANT: "Dormant", TESTING: "Testing",
};
const status = computed(() => {
  if (props.stale || !props.sample || props.sample.error) return "Unknown";
  if (props.simulated || props.sample.status === "simulated") return "Simulated";
  if (props.sample.status !== "available") return "Unknown";
  if (props.state === "admin") return props.sample.admin_up ? "Up" : "Down";
  const operational = props.sample.oper_state.toUpperCase();
  return operationalLabels[operational] ?? (operational ? `Unknown (${props.sample.oper_state})` : "Unknown");
});
const color = computed(() => status.value === "Up" ? "success" :
  ["Down", "Lower layer down", "Not present"].includes(status.value) ? "error" : status.value === "Dormant" ? "warning" : "default");
const title = computed(() => {
  if (props.sample?.error) return props.sample.error;
  if (props.stale) return "Live interface sample unavailable or stale";
  if (!props.sample || props.sample.status !== "available" || props.simulated) return `${props.state === "admin" ? "Administrative" : "Operational"} state: ${status.value}`;
  return props.state === "admin" ? `Administrative state: ${props.sample.admin_up ? "Up" : "Down"}` : `Kernel operational state: ${props.sample.oper_state}`;
});
</script>

<template>
  <v-chip
    :color="color"
    size="small"
    variant="tonal"
    :title="title"
  >
    {{ status }}
  </v-chip>
</template>