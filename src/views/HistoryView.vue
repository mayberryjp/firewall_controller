<script setup lang="ts">
import { onMounted } from "vue";
import { useControllerStore } from "@/stores/controller";
import DatasetStatus from "@/components/base/DatasetStatus.vue";
const store = useControllerStore();
onMounted(() => { void store.refreshRevisions(); });
</script>

<template>
  <section aria-label="Committed revisions">
    <DatasetStatus
      :query="store.revisions"
      label="Revision history"
    />
    <v-table>
      <thead><tr><th>Revision</th><th>Description</th><th>Submitted</th><th>Committed</th><th>Transaction</th></tr></thead>
      <tbody>
        <tr
          v-for="item in store.revisions.data"
          :key="item.revision"
        >
          <td>
            <router-link
              class="mono"
              :to="`/history/${item.revision}`"
            >
              {{ item.revision }}
            </router-link> {{ item.current ? "Current" : "" }}
          </td>
          <td>{{ item.description || "—" }}</td>
          <td :title="item.submitted_by">
            {{ item.submitted_at || "—" }}
          </td>
          <td :title="item.committed_by">
            {{ item.committed_at || "—" }}
          </td>
          <td>
            <router-link
              v-if="item.transaction_id"
              :to="`/transactions/${encodeURIComponent(item.transaction_id)}`"
            >
              {{ item.transaction_id }}
            </router-link>
            <p v-if="item.restored_from_revision !== undefined">
              Restored from {{ item.restored_from_revision }}
            </p>
          </td>
        </tr>
        <tr v-if="store.revisions.data && !store.revisions.data.length">
          <td colspan="5">
            No committed revisions returned.
          </td>
        </tr>
      </tbody>
    </v-table>
    <v-btn
      v-if="store.nextRevision !== undefined"
      class="mt-4"
      :loading="store.revisions.loading"
      @click="store.refreshRevisions(true)"
    >
      Load older revisions
    </v-btn>
  </section>
</template>