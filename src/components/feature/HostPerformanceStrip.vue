<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import DatasetStatus from "@/components/base/DatasetStatus.vue";
import { useControllerStore } from "@/stores/controller";
import { isInitialLoad } from "@/services/datasets";
import { cpuUsage, formatBytes, usagePercent, type HostHealth } from "@/services/hostHealth";

const store = useControllerStore(), cpu = ref<number | null>(null);
const snapshot = shallowRef<HostHealth | null>(null);
let previous: HostHealth | null = null, seen: HostHealth | null = null, session = store.sessionVersion;
const hidden = ref(document.visibilityState === "hidden");
watch(() => [store.hostHealth.data, store.hostHealth.stale, store.hostHealth.error, store.connected, store.sessionVersion] as const,
  ([data, stale, error, connected, currentSession]) => {
    if (!connected || session !== currentSession) {
      session = currentSession; previous = null; snapshot.value = null; cpu.value = null; seen = data;
      return;
    }
    if (stale || error || hidden.value) { previous = null; cpu.value = null; return; }
    if (data === seen) return;
    seen = data; snapshot.value = data;
    const valid = data && data.sample.status !== "simulated" &&
      data.sections.cpu.status === "available" && data.sections.uptime.status === "available";
    cpu.value = valid ? cpuUsage(data, previous) : null;
    previous = valid ? data : null;
  }, { immediate: true });
function visibilityChanged() {
  hidden.value = document.visibilityState === "hidden";
  previous = null; cpu.value = null;
}
onMounted(() => {
  document.addEventListener("visibilitychange", visibilityChanged);
  if (store.connected && !hidden.value) void store.refreshHostHealth();
});
onUnmounted(() => document.removeEventListener("visibilitychange", visibilityChanged));

const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const glyphs: Record<string, number[]> = {
  " ": [0, 0, 0, 0, 0], "(": [0, 28, 34, 65, 0], ")": [0, 65, 34, 28, 0],
  "%": [99, 19, 8, 100, 99], ".": [0, 96, 96, 0, 0], ",": [0, 64, 32, 0, 0], "-": [8, 8, 8, 8, 8],
  "0": [62, 81, 73, 69, 62], "1": [0, 66, 127, 64, 0], "2": [66, 97, 81, 73, 70],
  "3": [33, 65, 69, 75, 49], "4": [24, 20, 18, 127, 16], "5": [39, 69, 69, 69, 57],
  "6": [60, 74, 73, 73, 48], "7": [1, 113, 9, 5, 3], "8": [54, 73, 73, 73, 54], "9": [6, 73, 73, 41, 30],
  A: [126, 9, 9, 9, 126], B: [127, 73, 73, 73, 54], C: [62, 65, 65, 65, 34],
  D: [127, 65, 65, 34, 28], E: [127, 73, 73, 73, 65], F: [127, 9, 9, 9, 1],
  G: [62, 65, 73, 73, 122], H: [127, 8, 8, 8, 127], I: [0, 65, 127, 65, 0],
  J: [32, 64, 65, 63, 1], K: [127, 8, 20, 34, 65], L: [127, 64, 64, 64, 64],
  M: [127, 2, 12, 2, 127], N: [127, 4, 8, 16, 127], O: [62, 65, 65, 65, 62],
  P: [127, 9, 9, 9, 6], Q: [62, 65, 81, 33, 94], R: [127, 9, 25, 41, 70],
  S: [70, 73, 73, 73, 49], T: [1, 1, 127, 1, 1], U: [63, 64, 64, 64, 63],
  V: [31, 32, 64, 32, 31], W: [63, 64, 56, 64, 63], X: [99, 20, 8, 20, 99],
  Y: [3, 4, 120, 4, 3], Z: [97, 81, 73, 69, 67],
};
function dotMatrix(text: string) {
  let path = "";
  for (const [index, character] of [...text.toUpperCase()].entries()) {
    const columns = glyphs[character];
    if (!columns) throw new Error(`Unsupported host display character: ${character}`);
    columns.forEach((bits, column) => {
      for (let row = 0; row < 7; row++) {
        if (bits & (1 << row)) path += `M${index * 6 + column} ${row}h.8v.8h-.8z`;
      }
    });
  }
  return path;
}
const rows = computed(() => {
  const sections = snapshot.value?.sections;
  const pending = isInitialLoad(store.hostHealth);
  const missing = pending ? "Loading..." : snapshot.value?.sample.status === "simulated" ? "Simulated" : "Unavailable";
  const memory = sections?.memory.status === "available" ? sections.memory.data : null;
  const load = sections?.load.status === "available" ? sections.load.data : null;
  const percent = memory ? usagePercent(memory.used_bytes, memory.bytes.MemTotal) : null;
  return [
    { label: "CPU", value: cpu.value === null ? (sections?.cpu.status === "available" && sections.cpu.data && sections.uptime.status === "available" && sections.uptime.data &&
      !store.hostHealth.stale && !store.hostHealth.error ? "Collecting..." : missing) : `${number.format(cpu.value)}%`,
      detail: "Busy time, excluding idle and I/O wait", error: sections?.cpu.error ?? sections?.uptime.error },
    { label: "Memory", value: percent === null ? missing : `${number.format(percent)}%`,
      detail: memory ? `${formatBytes(memory.used_bytes)} / ${formatBytes(memory.bytes.MemTotal)}` : undefined, error: sections?.memory.error },
    { label: "Load (1 min)", value: load ? number.format(load.one) : missing,
      detail: load ? `5 min: ${number.format(load.five)}; 15 min: ${number.format(load.fifteen)}` : undefined, error: sections?.load.error },
  ].map(row => ({ ...row, labelDots: dotMatrix(row.label), valueDots: dotMatrix(row.value) }));
});
</script>

<template>
  <div class="host-performance-display">
    <section
      class="host-performance"
      aria-label="Host performance"
    >
      <dl class="host-metrics">
        <div
          v-for="row in rows"
          :key="row.label"
          :title="row.detail"
        >
          <dt>
            <span class="metric-text">{{ row.label }}</span>
            <svg
              :viewBox="`0 0 ${row.label.length * 6 - 1} 7`"
              aria-hidden="true"
              focusable="false"
            ><path :d="row.labelDots" /></svg>
          </dt>
          <dd>
            <span class="metric-text">{{ row.value }}</span>
            <svg
              :viewBox="`0 0 ${row.value.length * 6 - 1} 7`"
              aria-hidden="true"
              focusable="false"
            ><path :d="row.valueDots" /></svg>
          </dd>
        </div>
      </dl>
    </section>
    <div class="host-feedback">
      <DatasetStatus
        :query="store.hostHealth"
        label="Host performance"
      />
      <template
        v-for="row in rows"
        :key="row.label"
      >
        <p
          v-if="row.error"
          class="metric-error"
          role="status"
        >
          {{ row.label }}: {{ row.error }}
        </p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.host-performance-display { position: relative; }
.host-performance { min-width: 0; margin-top: 8px; padding: 6px 8px; border-radius: 8px; background: var(--bg-elevated); }
.host-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.host-metrics > div { min-width: 0; }
.metric-text { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
dt svg, dd svg { display: block; width: 100%; height: 1em; fill: currentColor; }
dt { color: var(--text-secondary); font-size: 9px; line-height: 12px; text-transform: uppercase; letter-spacing: .8px; }
dd { color: var(--text-primary); font-size: 13px; line-height: 20px; font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.metric-error { color: rgb(var(--v-theme-error)); font-size: 11px; overflow-wrap: anywhere; }
@media (max-width: 600px) {
  dd { font-size: 12px; }
}
</style>
