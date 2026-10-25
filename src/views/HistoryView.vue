<script setup lang="ts">
import { onMounted } from "vue";
import { formatTimestamp } from "@/services/timestamps";
import { useControllerStore } from "@/stores/controller";
import DatasetStatus from "@/components/base/DatasetStatus.vue";
const store = useControllerStore();
onMounted(() => { void store.refreshRevisions(); });
</script>

<template>
  <section aria-label="PUSH REQUESTS">
    <DatasetStatus
      :query="store.revisions"
      label="Revision history"
    />
    <v-table>
      <thead><tr><th>Revision</th><th>Description</th><th>Submitted (UTC)</th><th>Committed (UTC)</th><th>Commit</th></tr></thead>
      <tbody>
        <tr
          v-for="item in store.revisions.data"
          :key="item.revision"
        >
          <td>
            <router-link
              class="mono"
              :to="`/config/revisions/${item.revision}`"
            >
              {{ item.revision }}
            </router-link> {{ item.current ? "Current" : "" }}
          </td>
          <td>{{ item.description || "—" }}</td>
          <td :title="item.submitted_by">
            {{ formatTimestamp(item.submitted_at, "—") }}
          </td>
          <td :title="item.committed_by">
            {{ formatTimestamp(item.committed_at, "—") }}
          </td>
          <td>
            <router-link
              v-if="item.transaction_id"
              :to="`/config/commits/${encodeURIComponent(item.transaction_id)}`"
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
            No push requests returned.
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