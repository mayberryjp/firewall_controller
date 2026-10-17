<script setup lang="ts">
import { useControllerStore } from "@/stores/controller";
import DatasetStatus from "@/components/base/DatasetStatus.vue";
const store = useControllerStore();
</script>
<template>
  <section>
    <h1 class="text-h4 mb-4">
      Adopted parents
    </h1>
    <p class="mb-4">
      Read-only protected inventory. Provisioning/adoption and identity replacement require operator attention outside this UI. Parent MTU/up changes are not owned drift.
    </p>
    <DatasetStatus
      :query="store.runtime"
      label="Runtime / adopted parents"
    />
    <v-alert
      v-if="store.runtime.data?.error"
      type="warning"
      class="mb-4"
    >
      {{ store.runtime.data.error }}
    </v-alert>
    <v-table v-if="store.runtime.data">
      <thead><tr><th>Name</th><th>Kind / index</th><th>MAC</th><th>MTU</th><th>Administrative state</th><th>Availability / error</th></tr></thead>
      <tbody>
        <tr
          v-for="parent in store.runtime.data.parent_interfaces"
          :key="parent.name"
        >
          <td class="mono">
            {{ parent.name }}
          </td><td>{{ parent.kind }} / {{ parent.index }}</td><td class="mono">
            {{ parent.mac }}
          </td>
          <td>{{ parent.mtu }}</td><td>{{ parent.up ? "Admin up" : "Admin down" }}</td><td>{{ parent.available ? "Available" : "Unavailable" }}<p>{{ parent.error }}</p></td>
        </tr><tr v-if="!store.runtime.data.parent_interfaces.length">
          <td colspan="6">
            No adopted parent records.
          </td>
        </tr>
      </tbody>
    </v-table>
    <v-btn
      variant="text"
      class="mt-4"
      :loading="store.runtime.loading"
      @click="store.refreshRuntime"
    >
      Refresh parent/runtime inventory
    </v-btn>
  </section>
</template>
