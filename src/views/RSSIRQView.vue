<script setup lang="ts">
import { useControllerStore } from "@/stores/controller";
import { useInterfaceCapabilities } from "@/composables/useInterfaceCapabilities";
import { useTimestamps } from "@/composables/useTimestamps";
import { formatCount } from "@/services/counters";
import { formatInterfaceName, sortByInterface } from "@/services/interfaceNames";
import { rssState } from "@/services/interfaceCapabilities";

const store = useControllerStore();
const { snapshot, completed, loading, error, stale, refreshDenied, read } = useInterfaceCapabilities();
const { formatTimestamp, timeZone } = useTimestamps();
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
      <p v-if="!snapshot.inventory.interfaces.length">
        No interfaces.
      </p>
      <section
        v-for="row in sortByInterface(snapshot.inventory.interfaces, row => row.name)"
        :key="row.name"
        :aria-label="`${row.name} RSS / IRQ`"
        class="mt-4"
      >
        <h2 class="text-subtitle-1">
          {{ formatInterfaceName(row.name) }}
        </h2>
        <v-table density="compact">
          <thead><tr><th>RSS</th><th>RX queue targets</th><th>Hash</th><th>Input transformation</th></tr></thead>
          <tbody>
            <tr>
              <td>{{ rssState(row) }}</td>
              <td>{{ row.rss?.indirection_table == null ? 'Unknown' : [...new Set(row.rss.indirection_table)].join(', ') || 'None' }}</td>
              <td>{{ hash(row.rss?.hash_function) }}</td>
              <td>{{ row.rss?.input_transformation == null ? 'Unknown' : `0x${row.rss.input_transformation.toString(16)}` }}</td>
            </tr>
          </tbody>
        </v-table>
        <v-table
          density="compact"
          class="mt-2"
        >
          <thead><tr><th>Queue</th><th>IRQ</th><th>Effective CPUs</th></tr></thead>
          <tbody>
            <tr
              v-for="queue in row.queues"
              :key="queue.name"
            >
              <th scope="row">
                {{ queue.name }}
              </th>
              <td :title="queue.irq_mapping_reason ?? undefined">
                {{ queue.irqs == null ? 'Unknown' : queue.irqs.join(', ') || 'None' }}
              </td>
              <td>{{ queue.irqs == null ? 'Unknown' : queue.irqs.map(irq => `${irq}: ${cpus(row.interrupts?.find(item => item.irq === irq)?.effective_cpus)}`).join('; ') || 'None' }}</td>
            </tr>
            <tr v-if="!row.queues.length">
              <td colspan="3">
                No queues.
              </td>
            </tr>
          </tbody>
        </v-table>
        <details class="mt-2">
          <summary>Interrupts</summary>
          <p v-if="row.interrupts == null">
            Unknown
          </p>
          <v-table
            v-else
            density="compact"
          >
            <thead><tr><th>IRQ</th><th>Action</th><th>Effective CPUs</th><th>Interrupt counts by CPU</th><th>Errors</th></tr></thead>
            <tbody>
              <tr
                v-for="irq in row.interrupts"
                :key="irq.irq"
              >
                <th scope="row">
                  {{ irq.irq }}
                </th><td>{{ irq.description ?? 'Unknown' }}</td>
                <td>{{ cpus(irq.effective_cpus) }}</td>
                <td>{{ irq.counts == null ? 'Unknown' : irq.counts.map(count => `${count.cpu_id}: ${formatCount(count.interrupts)}`).join('; ') || 'None' }}</td>
                <td>{{ irq.errors.join('; ') || '-' }}</td>
              </tr>
              <tr v-if="!row.interrupts.length">
                <td colspan="5">
                  No interrupts.
                </td>
              </tr>
            </tbody>
          </v-table>
        </details>
        <p
          v-for="message in [...row.errors, ...row.capabilities.filter(feature => feature.name === 'rss').flatMap(feature => feature.reason ? [feature.reason] : [])]"
          :key="message"
          role="alert"
          class="text-error"
        >
          {{ message }}
        </p>
      </section>
    </template>
  </section>
</template>
