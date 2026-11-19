<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useDiagnosticRead } from "@/composables/useDiagnosticRead";
import { useTimestamps } from "@/composables/useTimestamps";
import { getSystemStatus } from "@/services/netcontrol";

const props = defineProps<{ sampleKey?: string }>();
const { formatTimestamp, timeZone } = useTimestamps();
const now = ref(performance.now()), resumed = ref(false);
const clock = useDiagnosticRead(async signal => ({
  status: await getSystemStatus(signal), receivedAt: performance.now(),
}), 15000, () => props.sampleKey ?? "");
watch(clock.data, value => {
  now.value = performance.now();
  if (value) resumed.value = false;
}, { flush: "sync" });
const elapsed = computed(() => clock.data.value ? Math.max(0, now.value - clock.data.value.receivedAt) : 0);
const stale = computed(() => clock.stale.value || resumed.value || elapsed.value >= 30000);
const currentTime = computed(() => clock.data.value
  ? Date.parse(clock.data.value.status.current_time) + elapsed.value : null);
const tick = setInterval(() => { now.value = performance.now(); }, 1000);
function visibilityChanged(): void {
  resumed.value = true;
  now.value = performance.now();
}
function resume(): void {
  visibilityChanged();
  clock.cancel();
  void clock.read();
}
document.addEventListener("visibilitychange", visibilityChanged);
window.addEventListener("pageshow", resume);
window.addEventListener("focus", resume);
onBeforeUnmount(() => {
  clearInterval(tick);
  document.removeEventListener("visibilitychange", visibilityChanged);
  window.removeEventListener("pageshow", resume);
  window.removeEventListener("focus", resume);
});
</script>

<template>
  <div class="mb-4">
    <p>
      Current firewall time ({{ timeZone }}):
      <output
        :aria-label="`Current firewall time (${timeZone})`"
        aria-live="off"
        title="Locally advanced estimate of the daemon clock, including request/network latency; not a fresh NTP reading or proof of synchronization."
      >{{ currentTime === null ? clock.error.value ? 'Unavailable' : 'Loading...' : formatTimestamp(currentTime) }}</output>
      <span v-if="clock.data.value && stale"> (stale estimate)</span>
    </p>
    <p
      v-if="clock.error.value"
      role="alert"
      class="text-error"
    >
      {{ clock.error.value }}
    </p>
  </div>
</template>
