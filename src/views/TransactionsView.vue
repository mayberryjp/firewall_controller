<script setup lang="ts">
import { computed, ref, onMounted } from "vue";
import { useTimestamps } from "@/composables/useTimestamps";
import { useControllerStore } from "@/stores/controller";
import DatasetStatus from "@/components/base/DatasetStatus.vue";
const { formatTimestamp, timeZone } = useTimestamps();
const store = useControllerStore();
const search = ref(""), status = ref("All"), page = ref(1);
const filtered = computed(() => store.sortedTransactions.filter(item =>
  (status.value === "All" || item.status === status.value) && JSON.stringify(item).toLowerCase().includes(search.value.toLowerCase())));
onMounted(() => { void store.refreshTransactions(); });
</script>
<template>
  <section aria-label="Commits">
    <DatasetStatus
      :query="store.transactions"
      label="Independent commit discovery"
    />
    <div
      v-if="store.sortedTransactions.length > 20"
      class="filter-grid"
    >
      <v-text-field
        v-model="search"
        label="Filter commit text"
        @update:model-value="page = 1"
      />
      <v-select
        v-model="status"
        :items="['All', ...new Set(store.sortedTransactions.map(item => item.status))]"
        label="Server status"
        @update:model-value="page = 1"
      />
    </div>
    <v-table>
      <thead>
        <tr>
          <th>Commit</th><th>Status</th><th>Description</th>
          <th class="text-no-wrap">
            Submitted ({{ timeZone }})
          </th>
          <th class="text-no-wrap">
            Base revision
          </th>
          <th>Deadline ({{ timeZone }})</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="item in filtered.slice((page - 1) * 20, page * 20)"
          :key="item.id"
        >
          <td>
            <router-link
              class="mono text-no-wrap"
              :to="`/config/commits/${encodeURIComponent(item.id)}`"
            >
              {{ item.id }}
            </router-link>
          </td>
          <td class="text-no-wrap">
            {{ item.status.replaceAll("_", " ") }}
          </td>
          <td :title="item.actor">
            {{ item.description || "—" }}
          </td>
          <td class="text-no-wrap">
            {{ formatTimestamp(item.submitted_at, "—") }}
          </td>
          <td class="mono text-no-wrap">
            {{ item.base_revision }}
          </td>
          <td>{{ item.status === "pending_confirmation" ? formatTimestamp(item.confirmation_deadline) : "—" }}</td>
        </tr><tr v-if="!filtered.length">
          <td colspan="6">
            No matching commit records.
          </td>
        </tr>
      </tbody>
    </v-table>
    <v-pagination
      v-if="filtered.length > 20"
      v-model="page"
      :length="Math.ceil(filtered.length / 20)"
    />
  </section>
</template>
