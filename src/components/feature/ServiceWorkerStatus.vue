<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  status?: { state?: string; process_state?: string; retrying?: boolean; restart_count?: number; last_error?: string; error?: string | null };
  label?: string;
}>();
const labels: Record<string, string> = {
  disabled: "Disabled", simulated: "Simulated", unavailable: "Unavailable", not_running: "Not running",
  running: "Running", unhealthy: "Unhealthy", exited: "Exited", stopped: "Stopped", error: "Error", waiting: "Waiting",
};
const text = computed(() => {
  if (!props.status) return props.label ?? "Unknown";
  if (props.status.retrying === true) return "Recovering";
  const state = props.status.state ?? props.status.process_state;
  return props.label ?? (state ? labels[state] ?? `Unknown (${state})` : "Unknown");
});
const details = computed(() => [
  props.status?.retrying === true ? "Automatic retry in progress" : "",
  props.status?.restart_count !== undefined ? `Restart count: ${props.status.restart_count}` : "",
  props.status?.error ? `Current error: ${props.status.error}` : "",
  props.status?.last_error ? `Last failure: ${props.status.last_error}` : "",
].filter(Boolean).join("; ") || undefined);
</script>

<template>
  <span :title="details">{{ text }}</span>
</template>