<script setup lang="ts">
import { computed } from "vue";
import { useControllerStore } from "@/stores/controller";
import OverviewWidget from "./OverviewWidget.vue";
const store = useControllerStore();
const counters = [
  { label: "Packets in", key: "rx_packets" }, { label: "Packets out", key: "tx_packets" },
  { label: "Bytes in", key: "rx_bytes" }, { label: "Bytes out", key: "tx_bytes" },
  { label: "Errors in", key: "rx_errors" }, { label: "Errors out", key: "tx_errors" },
];
const note = computed(() => store.statistics.error ? "Unavailable" : store.statistics.loading && !store.statistics.data ? "Loading" : store.statistics.stale ? "Stale" : store.statistics.data?.sample.status === "simulated" ? "Simulated" : "");
</script>

<template>
  <OverviewWidget
    title="Interface counters"
    to="/interfaces"
    :note="note"
    :detail="store.statistics.error ?? undefined"
  >
    <v-table density="compact">
      <thead>
        <tr>
          <th>Counter</th><th
            v-for="item in store.statistics.data?.interfaces"
            :key="item.name"
          >
            {{ item.name }}
          </th>
        </tr>
      </thead>
      <tbody v-if="store.statistics.data?.interfaces.length">
        <tr
          v-for="counter in counters"
          :key="counter.key"
        >
          <th scope="row">
            {{ counter.label }}
          </th>
          <td
            v-for="item in store.statistics.data.interfaces"
            :key="item.name"
            class="mono"
          >
            {{ item.counters?.[counter.key] ?? "Unavailable" }}
          </td>
        </tr>
      </tbody>
      <tbody v-else>
        <tr><td>No interface counters available.</td></tr>
      </tbody>
    </v-table>
  </OverviewWidget>
</template>