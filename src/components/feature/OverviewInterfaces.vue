<script setup lang="ts">
import { computed } from "vue";
import { useControllerStore } from "@/stores/controller";
import OverviewWidget from "./OverviewWidget.vue";
import OverviewInterfaceStatus from "./OverviewInterfaceStatus.vue";
const store = useControllerStore();
const rows = computed(() => [...new Set([
  ...(store.statistics.data?.interfaces.map(item => item.name) ?? []),
  ...(store.state.data?.desired.interfaces.map(item => item.name) ?? []),
])].map(name => ({ name, sample: store.statistics.data?.interfaces.find(item => item.name === name) })));
const note = computed(() => store.statistics.error ? "Unavailable" : store.statistics.loading && !store.statistics.data ? "Loading" : store.statistics.stale ? "Stale" : store.statistics.data?.sample.status === "simulated" ? "Simulated" : "");
</script>

<template>
  <OverviewWidget
    title="Interfaces"
    :note="note"
    :detail="store.statistics.error ?? undefined"
  >
    <v-table density="compact">
      <thead><tr><th>Name</th><th>Status</th><th>MTU</th></tr></thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.name"
        >
          <td>{{ row.name }}</td>
          <td>
            <OverviewInterfaceStatus
              :sample="row.sample"
              :stale="store.statistics.stale || Boolean(store.statistics.error)"
              :simulated="store.statistics.data?.sample.status === 'simulated'"
            />
          </td>
          <td>{{ row.sample?.mtu ?? "Unknown" }}</td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="3">
            {{ store.statistics.data ? "No interfaces." : "Interface status unavailable." }}
          </td>
        </tr>
      </tbody>
    </v-table>
  </OverviewWidget>
</template>