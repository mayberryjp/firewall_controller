<script setup lang="ts">
import { computed, ref } from "vue";
import { useLogHistory } from "@/composables/useLogHistory";
import { useTimestamps } from "@/composables/useTimestamps";
import { getPersistentLog } from "@/services/netcontrol";
import type { LogSource } from "@/services/logs";
import ServiceWorkerStatus from "@/components/feature/ServiceWorkerStatus.vue";

const props = defineProps<{ source: LogSource; active: boolean }>();
const mode = ref("recent"), startCursor = ref<string>();
const { data, loading, error, stale } = useLogHistory(async (cursor, signal) => {
  const page = await getPersistentLog(props.source, { cursor, limit: 100 }, signal);
  return { page, entries: page.entries };
}, 3000, () => `${props.source}:${mode.value}`, () => props.active, () => startCursor.value);
const displayedEntries = computed(() => [...(data.value?.entries ?? [])].reverse());
const { formatTimestamp, timeZone } = useTimestamps();
function changeMode(value: string): void {
  startCursor.value = value === "history" ? data.value?.page.oldest_cursor ?? undefined : undefined;
  mode.value = value;
}
</script>

<template>
  <section :aria-label="`${source} log stream`">
    <v-select
      :model-value="mode"
      :items="[{ title: 'Recent / live', value: 'recent' }, { title: 'Retained history', value: 'history' }]"
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
      >
        <thead><tr><th>Time ({{ timeZone }})</th><th>Message</th></tr></thead>
        <tbody>
          <tr
            v-for="entry in displayedEntries"
            :key="entry.sequence"
          >
            <td class="log-time">
              <time :datetime="entry.timestamp">{{ formatTimestamp(entry.timestamp) }}</time>
            </td>
            <td class="log-message">
              {{ entry.message }}
            </td>
          </tr>
          <tr v-if="!data.entries.length">
            <td colspan="2">
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
</style>
