<script setup lang="ts">
import { computed, ref } from "vue";
import { useLogHistory } from "@/composables/useLogHistory";
import { useTimestamps } from "@/composables/useTimestamps";
import { getPersistentLog } from "@/services/netcontrol";
import type { LogSource } from "@/services/logs";
import { parsePerformanceLog } from "@/services/logs";
import PerformanceLogMessage from "@/components/feature/PerformanceLogMessage.vue";
import ServiceWorkerStatus from "@/components/feature/ServiceWorkerStatus.vue";

const props = defineProps<{ source: LogSource; active: boolean }>();
const modes = [{ title: "Recent / live", value: "recent" }, { title: "Retained history", value: "history" }];
const mode = ref("recent"), startCursor = ref<string>();
const { data, loading, error, stale } = useLogHistory(async (cursor, signal) => {
  let page = await getPersistentLog(props.source, { cursor, limit: 100 }, signal);
  const first = page.entries[0], oldest = page.oldest_cursor;
  if (props.source === "performance" && cursor === undefined && first && oldest
    && BigInt(first.sequence) > BigInt(oldest.split(":")[1]!) + 1n) {
    const retained = await getPersistentLog(props.source, { cursor: oldest, limit: 100 }, signal);
    page = { ...retained, gap: page.gap || retained.gap, reset: page.reset || retained.reset };
  }
  return { page, entries: page.entries };
}, 3000, () => `${props.source}:${mode.value}`, () => props.active, () => startCursor.value);
const displayedEntries = computed(() => [...(data.value?.entries ?? [])].reverse().flatMap(entry => {
  const performance = props.source === "performance" ? parsePerformanceLog(entry.message) : null;
  const evidence = performance?.event === "link_observation" && Array.isArray(performance.details?.evidence)
    ? performance.details.evidence : [];
  const issues = performance && evidence.length ? evidence.map(item => ({
    ...performance, details: { ...performance.details, evidence: [item] },
  })) : [performance];
  return issues.map((issue, index) => ({
    ...entry, rowKey: `${entry.sequence}:${index}`, performance: issue,
    displayTime: props.source === "performance" ? performance?.observed_at ?? null : entry.timestamp,
  }));
}));
const { formatTimestamp, timeZone } = useTimestamps();
function changeMode(value: string): void {
  startCursor.value = value === "history" ? data.value?.page.oldest_cursor ?? undefined : undefined;
  mode.value = value;
}
</script>

<template>
  <section :aria-label="`${source} log stream`">
    <v-select
      v-if="source !== 'performance'"
      :model-value="mode"
      :items="modes"
      label="View"
      density="compact"
      hide-details
      :disabled="!data || loading"
      class="mb-3"
      @update:model-value="changeMode"
    />
    <p
      v-if="loading && !data"
      role="status"
    >
      Loading logs...
    </p>
    <p
      v-if="error"
      role="alert"
      class="text-error"
    >
      {{ error }}<span v-if="error.includes('403')"> Requires logs.read.</span>
    </p>
    <template v-if="data">
      <p
        v-if="stale"
        role="status"
      >
        Last-known logs.
      </p>
      <p
        v-if="data.gap"
        role="status"
      >
        Some retained log entries expired.
      </p>
      <p
        v-if="data.reset"
        role="status"
      >
        Log history restarted.
      </p>
      <p
        v-if="data.trimmed"
        role="status"
      >
        Older displayed entries removed.
      </p>
      <p
        v-if="data.page.capture.state !== 'running' || data.page.capture.retrying"
        role="status"
      >
        Capture: <ServiceWorkerStatus :status="data.page.capture" />
      </p>
      <p
        v-if="data.page.capture.error"
        role="alert"
        class="text-error"
      >
        {{ data.page.capture.error }}
      </p>
      <v-table
        density="compact"
        class="persistent-log-table"
        :class="{ 'persistent-log-table--performance': source === 'performance' }"
      >
        <thead>
          <tr>
            <th>{{ source === 'performance' ? 'Observed' : 'Time' }} ({{ timeZone }})</th>
            <template v-if="source === 'performance'">
              <th>Event</th><th>Resource</th><th>Interface</th><th>Target</th><th>Evidence</th>
            </template>
            <th v-else>
              Message
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="entry in displayedEntries"
            :key="entry.rowKey"
          >
            <td class="log-time">
              <time
                :datetime="entry.displayTime ?? undefined"
                :title="source === 'performance' ? `Persisted (${timeZone}): ${formatTimestamp(entry.timestamp)}` : undefined"
              >{{ formatTimestamp(entry.displayTime) }}</time>
            </td>
            <PerformanceLogMessage
              v-if="source === 'performance'"
              :event="entry.performance"
              :message="entry.message"
            />
            <td
              v-else
              class="log-message"
            >
              {{ entry.message }}
            </td>
          </tr>
          <tr v-if="!data.entries.length">
            <td :colspan="source === 'performance' ? 6 : 2">
              No retained log entries.
            </td>
          </tr>
        </tbody>
      </v-table>
    </template>
  </section>
</template>

<style scoped>
.persistent-log-table :deep(table) { table-layout: fixed; width: 100%; }
.persistent-log-table :deep(th:first-child) { width: 176px; }
.log-time { vertical-align: top; white-space: nowrap; }
.log-message { white-space: pre-wrap; overflow-wrap: anywhere; font-family: monospace; }
.persistent-log-table--performance :deep(table) { table-layout: auto; }
.persistent-log-table--performance :deep(th), .persistent-log-table--performance :deep(td) { white-space: nowrap; }
.persistent-log-table--performance .log-message { white-space: nowrap; }
.persistent-log-table--performance .log-time { vertical-align: middle; }
</style>
