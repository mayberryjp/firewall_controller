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
    :note="note"
    :detail="store.statistics.error ?? undefined"
  >
    <v-table density="compact">
      <thead>
        <tr>
          <th scope="col">
            Interface
          </th>
          <th
            v-for="counter in counters"
            :key="counter.key"
            scope="col"
          >
            {{ counter.label }}
          </th>
        </tr>
      </thead>
      <tbody v-if="store.statistics.data?.interfaces.length">
        <tr
          v-for="item in store.statistics.data.interfaces"
          :key="item.name"
        >
          <th scope="row">
            {{ item.name }}
          </th>
          <td
            v-for="counter in counters"
            :key="counter.key"
            class="mono"
          >
            {{ item.counters?.[counter.key] ?? "Unavailable" }}
          </td>
        </tr>
      </tbody>
      <tbody v-else>
        <tr>
          <td :colspan="counters.length + 1">
            No interface counters available.
          </td>
        </tr>
      </tbody>
    </v-table>
  </OverviewWidget>
</template>