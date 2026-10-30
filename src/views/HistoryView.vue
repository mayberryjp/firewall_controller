<script setup lang="ts">
import { onMounted } from "vue";
import { useTimestamps } from "@/composables/useTimestamps";
import { useControllerStore } from "@/stores/controller";
import { useConfigExport } from "@/composables/useConfigExport";
import DatasetStatus from "@/components/base/DatasetStatus.vue";
const { formatTimestamp, timeZone } = useTimestamps();
const store = useControllerStore();
const { exportError, downloading, downloadCommittedConfig } = useConfigExport();
onMounted(() => { void store.refreshRevisions(); });
</script>

<template>
  <section aria-label="PUSH REQUESTS">
    <v-btn
      prepend-icon="mdi-download"
      class="mb-4"
      :loading="downloading"
      :disabled="!store.connected || downloading"
      @click="downloadCommittedConfig"
    >
      Download committed configuration
    </v-btn>
    <v-alert
      v-if="exportError"
      type="error"
      class="mb-4"
    >
      {{ exportError }}
    </v-alert>
    <DatasetStatus
      :query="store.revisions"
      label="Revision history"
    />
    <v-table>
      <thead><tr><th>Revision</th><th>Description</th><th>Submitted ({{ timeZone }})</th><th>Committed ({{ timeZone }})</th><th>Commit</th></tr></thead>
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
              class="text-no-wrap"
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