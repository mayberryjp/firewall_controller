<script setup lang="ts">
import { computed } from "vue";
import { useControllerStore } from "@/stores/controller";
import { useInterfaceCapabilities } from "@/composables/useInterfaceCapabilities";
import { useTimestamps } from "@/composables/useTimestamps";
import { formatInterfaceName, sortByInterface } from "@/services/interfaceNames";
import { rssState, type InterfaceCapabilities } from "@/services/interfaceCapabilities";

const store = useControllerStore();
const { snapshot, completed, loading, error, stale, refreshDenied, read } = useInterfaceCapabilities();
const { formatTimestamp, timeZone } = useTimestamps();
const interfacesPending = computed(() => !store.state.data && !store.runtime.data && (store.state.loading || store.runtime.loading));
const rows = computed(() => sortByInterface((snapshot.value?.inventory.interfaces ?? []).filter(row => {
  if (row.kind !== "ethernet" || !row.hardware) return false;
  const configured = store.state.data?.desired.interfaces.find(link => link.name === row.name);
  if (configured) return configured.kind === "ethernet" && configured.up;
  const parent = store.runtime.data?.parent_interfaces.find(link => link.name === row.name);
  return parent?.kind === "ethernet" && parent.available && parent.up === true;
}), row => row.name));
const rssColors = { Enabled: "success", Disabled: "warning", "Not supported": "error", Unknown: "default" };
function queueCpus(row: InterfaceCapabilities, queue: InterfaceCapabilities["queues"][number]): string {
  return queue.irqs == null ? "Unknown" : queue.irqs.map(irq => `${irq}: ${cpus(row.interrupts?.find(item => item.irq === irq)?.effective_cpus)}`).join("; ") || "None";
}
function hash(value: number | null | undefined): string {
  if (value == null) return "Unknown";
  const names = [[1, "Toeplitz"], [2, "XOR"], [4, "CRC32"]] as const;
  return [...names.filter(([bit]) => value & bit).map(([, name]) => name),
    ...(value & ~7 ? [`0x${(value & ~7).toString(16)}`] : [])].join(", ") || "None";
}
const cpus = (values: number[] | null | undefined) => values == null ? "Unknown" : values.join(", ") || "None";
</script>

<template>
  <section aria-label="RSS / IRQ observations">
    <header class="d-flex flex-wrap align-center justify-space-between ga-3 mb-4">
      <h1 class="text-h6">
        RSS / IRQ
      </h1>
      <v-btn
        :loading="loading"
        :disabled="!store.connected || loading || refreshDenied || Boolean(store.pathTestWriteBlockedReason)"
        :title="store.pathTestWriteBlockedReason"
        @click="read(true)"
      >
        Refresh
      </v-btn>
    </header>
    <p
      v-if="loading && !snapshot"
      role="status"
    >
      Loading observations...
    </p>
    <p
      v-if="error"
      role="alert"
      class="text-error"
    >
      {{ error }}
    </p>
    <p
      v-if="stale"
      role="status"
    >
      Last-known snapshot.
    </p>
    <p
      v-if="completed && !snapshot && !error"
      role="status"
    >
      No saved snapshot.
    </p>
    <template v-if="snapshot">
      <p class="text-caption">
        Collected ({{ timeZone }}): <time :datetime="snapshot.collected_at">{{ formatTimestamp(snapshot.collected_at) }}</time>
        <span v-if="snapshot.inventory.status !== 'observed'"> · {{ snapshot.inventory.status }}</span>
      </p>
      <p
        v-for="message in snapshot.inventory.errors"
        :key="message"
        role="alert"
        class="text-error"
      >
        {{ message }}
      </p>
      <p
        v-if="interfacesPending"
        role="status"
      >
        Loading interfaces...
      </p>
      <p
        v-else-if="!rows.length && !store.state.error && !store.runtime.error"
        role="status"
      >
        No enabled physical interfaces.
      </p>
      <p
        v-if="store.state.error || store.runtime.error"
        role="alert"
        class="text-error"
      >
        {{ store.state.error || store.runtime.error }}
      </p>
      <v-table
        v-if="rows.length"
        density="compact"
        class="rss-irq-table"
        aria-label="Enabled physical interfaces RSS / IRQ"
      >
        <thead>
          <tr><th>Interface</th><th>RSS</th><th>RX queue targets</th><th>Hash</th><th>Input transformation</th><th>Queue</th><th>IRQ</th><th>Effective CPUs</th></tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.name"
          >
            <th scope="row">
              {{ formatInterfaceName(row.name) }}
              <p
                v-for="message in [...row.errors, ...row.capabilities.filter(feature => feature.name === 'rss').flatMap(feature => feature.reason ? [feature.reason] : [])]"
                :key="message"
                role="alert"
                class="text-error text-caption"
              >
                {{ message }}
              </p>
            </th>
            <td>
              <v-chip
                :color="rssColors[rssState(row)]"
                size="small"
                variant="tonal"
              >
                {{ rssState(row) }}
              </v-chip>
            </td>
            <td>
              <v-chip
                :color="row.rss?.indirection_table == null ? 'default' : 'info'"
                size="small"
                variant="tonal"
              >
                {{ row.rss?.indirection_table == null ? 'Unknown' : [...new Set(row.rss.indirection_table)].join(', ') || 'None' }}
              </v-chip>
            </td>
            <td>
              <v-chip
                :color="row.rss?.hash_function == null ? 'default' : 'info'"
                size="small"
                variant="tonal"
              >
                {{ hash(row.rss?.hash_function) }}
              </v-chip>
            </td>
            <td>
              <v-chip
                :color="row.rss?.input_transformation == null ? 'default' : 'info'"
                size="small"
                variant="tonal"
              >
                {{ row.rss?.input_transformation == null ? 'Unknown' : `0x${row.rss.input_transformation.toString(16)}` }}
              </v-chip>
            </td>
            <td>
              <div
                v-for="queue in row.queues"
                :key="queue.name"
                class="queue-observation"
              >
                <v-chip
                  color="info"
                  size="small"
                  variant="tonal"
                >
                  {{ queue.name }}
                </v-chip>
              </div>
              <span v-if="!row.queues.length">No queues.</span>
            </td>
            <td>
              <div
                v-for="queue in row.queues"
                :key="queue.name"
                class="queue-observation"
              >
                <v-chip
                  :color="queue.irqs == null ? 'default' : 'info'"
                  :title="queue.irq_mapping_reason ?? undefined"
                  size="small"
                  variant="tonal"
                >
                  {{ queue.irqs == null ? 'Unknown' : queue.irqs.join(', ') || 'None' }}
                </v-chip>
              </div>
              <span v-if="!row.queues.length">-</span>
            </td>
            <td>
              <div
                v-for="queue in row.queues"
                :key="queue.name"
                class="queue-observation"
              >
                <v-chip
                  :color="queue.irqs == null || queue.irqs.some(irq => row.interrupts?.find(item => item.irq === irq)?.effective_cpus == null) ? 'default' : 'info'"
                  size="small"
                  variant="tonal"
                >
                  {{ queueCpus(row, queue) }}
                </v-chip>
              </div>
              <p
                v-for="message in row.interrupts?.flatMap(irq => irq.errors) ?? []"
                :key="message"
                role="alert"
                class="text-error text-caption"
              >
                {{ message }}
              </p>
              <span v-if="!row.queues.length">-</span>
            </td>
          </tr>
        </tbody>
      </v-table>
    </template>
  </section>
</template>

<style scoped>
.rss-irq-table :deep(th),
.rss-irq-table :deep(td) { vertical-align: top; padding-top: 8px; padding-bottom: 8px; }
.queue-observation { min-height: 28px; white-space: nowrap; }
</style>
