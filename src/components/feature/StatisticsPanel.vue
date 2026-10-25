<script setup lang="ts">
import { useControllerStore } from "@/stores/controller";
import { formatTimestamp } from "@/services/timestamps";
import DatasetStatus from "@/components/base/DatasetStatus.vue";
import JsonPanel from "@/components/base/JsonPanel.vue";
const store = useControllerStore();
</script>
<template>
  <section
    aria-labelledby="statistics-title"
    class="mt-8"
  >
    <h2
      id="statistics-title"
      class="text-h5 mb-3"
    >
      Read-only networking statistics
    </h2>
    <DatasetStatus
      :query="store.statistics"
      label="Statistics"
    />
    <template v-if="store.statistics.data">
      <p class="mb-3">
        {{ store.statistics.data.sample.status }} · scope {{ store.statistics.data.sample.scope }} · collection window
        {{ formatTimestamp(store.statistics.data.sample.started_at) }} – {{ formatTimestamp(store.statistics.data.sample.collected_at) }} (UTC).
        Counters are exact decimal strings; unavailable values are not zero. This is not an atomic snapshot.
      </p>
      <v-alert
        v-if="store.statistics.data.sample.status === 'simulated'"
        type="info"
        variant="tonal"
        class="mb-4"
      >
        Simulated data, not Linux traffic. No throughput or collector-delivery claim.
      </v-alert>
      <v-table class="mb-4">
        <thead><tr><th>Interface / ownership</th><th>Administrative / operational</th><th>Status</th><th>RX bytes</th><th>TX bytes</th><th>Details</th></tr></thead>
        <tbody>
          <tr
            v-for="item in store.statistics.data.interfaces"
            :key="`${item.name}/${item.index}`"
          >
            <td class="mono">
              {{ item.name }}<br>{{ item.kind }} · {{ item.ownership }}
            </td>
            <td>{{ item.admin_up ? "Admin up" : "Admin down" }} / {{ item.oper_state }}<br>MTU {{ item.mtu }}</td>
            <td>
              {{ item.status }}<p v-if="item.error">
                {{ item.error }}
              </p>
            </td>
            <td class="mono">
              {{ item.counters?.rx_bytes ?? "Unavailable" }}
            </td>
            <td class="mono">
              {{ item.counters?.tx_bytes ?? "Unavailable" }}
            </td>
            <td>
              <JsonPanel
                :value="item"
                label="All counters / identity"
              />
            </td>
          </tr>
          <tr v-if="!store.statistics.data.interfaces.length">
            <td colspan="6">
              No interface statistics returned.
            </td>
          </tr>
        </tbody>
      </v-table>
      <v-expansion-panels>
        <v-expansion-panel
          v-for="protocol in store.statistics.data.protocols"
          :key="protocol.name"
        >
          <v-expansion-panel-title>{{ protocol.name }} · {{ protocol.status }}</v-expansion-panel-title>
          <v-expansion-panel-text>
            <p
              v-if="protocol.error"
              role="alert"
            >
              {{ protocol.error }}
            </p>
            <p v-if="!protocol.groups">
              Protocol groups unavailable.
            </p>
            <JsonPanel
              v-else
              :value="protocol.groups"
              label="Exact protocol values (includes gauges/constants)"
            />
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
    </template>
  </section>
</template>
