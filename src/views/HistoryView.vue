<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useControllerStore } from "@/stores/controller";
import { revisionSchema } from "@/types/domain";
import { useConfigExport } from "@/composables/useConfigExport";
import { differences, requiredPermissions } from "@/services/configuration";
import DatasetStatus from "@/components/base/DatasetStatus.vue";
import ConfigDiff from "@/components/feature/ConfigDiff.vue";
import JsonPanel from "@/components/base/JsonPanel.vue";
const store = useControllerStore(), route = useRoute(), router = useRouter();
const id = computed(() => typeof route.params.revision === "string" ? route.params.revision : "");
const detail = computed(() => store.revisionDetail.data);
const compareID = ref(""), error = ref(""), restoreDialog = ref(false);
const comparison = computed(() => store.comparisonRevision.data?.config);
const seconds = ref<number | string>(120), description = ref(""), acknowledged = ref(false);
const { exportConfig, exportError } = useConfigExport();
const canRestore = computed(() => store.freshState && !store.state.data?.drift && !store.draft && !store.submitted &&
  !store.busy && !store.uncertain && !store.activeTransactions.length && !store.incompatible);
const restorePermissions = computed(() => detail.value && store.state.data
  ? ["state.read", ...requiredPermissions(differences(store.state.data.desired, detail.value.config))] : []);
watch(id, async (value) => {
  error.value = ""; store.clearComparison(); compareID.value = "";
  if (value) {
    if (!revisionSchema.safeParse(value).success) { error.value = "Invalid uint64 revision"; return; }
    await store.loadRevision(value);
  } else await store.refreshRevisions();
}, { immediate: true });
async function compare(): Promise<void> {
  try { revisionSchema.parse(compareID.value); await store.compareRevision(compareID.value); error.value = ""; }
  catch (failure) { error.value = failure instanceof Error ? failure.message : "Comparison unavailable"; }
}
async function restore(): Promise<void> {
  if (!acknowledged.value) return;
  try {
    const result = await store.restore(id.value, Number(seconds.value), description.value);
    restoreDialog.value = false;
    if (result) await router.push(`/transactions/${encodeURIComponent(result.id)}`);
  } catch (failure) { error.value = failure instanceof Error ? failure.message : "Restore failed"; }
}
</script>
<template>
  <section>
    <h1 class="text-h4 mb-4">
      Committed history{{ id ? ` · revision ${id}` : "" }}
    </h1>
    <p class="mb-4">
      Immutable committed desired configuration. Restoration is provisional and creates the next revision after confirmation; it never rewinds history or restores counter/process history.
    </p>
    <v-alert
      v-if="error || exportError"
      type="error"
      class="mb-4"
    >
      {{ error || exportError }}
    </v-alert>
    <template v-if="id">
      <DatasetStatus
        :query="store.revisionDetail"
        label="Historical revision"
      />
      <template v-if="detail && detail.revision === id">
        <v-card
          border
          class="pa-5 mb-5"
        >
          <h2 class="text-h6">
            Revision {{ detail.revision }}{{ detail.current ? " (current at read time)" : "" }}
          </h2>
          <p>{{ detail.description || "No description" }}</p>
          <p>Submitted {{ detail.submitted_at || "Unknown (legacy record)" }} · {{ detail.submitted_by || "Unknown" }}</p>
          <p>Committed {{ detail.committed_at || "Unknown (legacy record)" }} · {{ detail.committed_by || "Unknown" }}</p>
          <p v-if="detail.restored_from_revision !== undefined">
            Restored from revision {{ detail.restored_from_revision }}
          </p>
          <router-link
            v-if="detail.transaction_id"
            :to="`/transactions/${encodeURIComponent(detail.transaction_id)}`"
          >
            Recorded transaction
          </router-link>
        </v-card>
        <div class="d-flex flex-wrap ga-3 mb-5">
          <v-btn @click="exportConfig(detail.config, `netcontrol-revision-${id}`)">
            Export config
          </v-btn>
          <v-btn
            color="warning"
            :disabled="!canRestore"
            @click="restoreDialog = true; acknowledged = false"
          >
            Preview restore this revision
          </v-btn>
        </div>
        <v-alert
          v-if="store.draft"
          type="warning"
          class="mb-4"
        >
          A local draft exists. Export and explicitly discard it in Changes before restoration.<v-btn
            variant="text"
            to="/changes"
          >
            Review draft
          </v-btn>
        </v-alert>
        <h2 class="text-h5 mb-4">
          Historical versus current committed desired
        </h2>
        <ConfigDiff
          v-if="store.state.data"
          :before="detail.config"
          :after="store.state.data.desired"
        />
        <div class="filter-grid">
          <v-text-field
            v-model="compareID"
            label="Compare against another exact revision (including 0)"
          /><v-btn @click="compare">
            Load comparison
          </v-btn>
        </div>
        <DatasetStatus
          v-if="store.comparisonRevision.loading || store.comparisonRevision.error || comparison"
          :query="store.comparisonRevision"
          label="Selected comparison revision"
        />
        <ConfigDiff
          v-if="comparison"
          :before="detail.config"
          :after="comparison"
        />
        <JsonPanel
          :value="detail.config"
          label="Complete immutable historical configuration"
        />
      </template>
      <v-btn
        to="/history"
        variant="text"
      >
        All committed revisions
      </v-btn>
    </template>
    <template v-else>
      <DatasetStatus
        :query="store.revisions"
        label="Revision history"
      />
      <v-table>
        <thead><tr><th>Revision / current</th><th>Description</th><th>Submitted / by</th><th>Committed / by</th><th>Transaction / source</th></tr></thead>
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
            <td>{{ item.description || "No description" }}</td><td>{{ item.submitted_at || "Unknown (legacy record)" }}<br>{{ item.submitted_by || "Unknown" }}</td>
            <td>{{ item.committed_at || "Unknown (legacy record)" }}<br>{{ item.committed_by || "Unknown" }}</td>
            <td>
              <router-link
                v-if="item.transaction_id"
                :to="`/transactions/${encodeURIComponent(item.transaction_id)}`"
              >
                {{ item.transaction_id }}
              </router-link>
              <p>Restored from {{ item.restored_from_revision ?? "None" }}</p>
            </td>
          </tr><tr v-if="store.revisions.data && !store.revisions.data.length">
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
      <p
        v-else-if="store.revisions.data"
        class="mt-4"
      >
        End of committed history.
      </p>
    </template>
    <v-dialog
      v-model="restoreDialog"
      max-width="850"
      scrollable
      persistent
    >
      <v-card :title="`Restore revision ${id} provisionally`">
        <v-card-text>
          <p class="mb-4">
            Review the complete replacement/deletion impact. Historical key files may be unavailable and current restrictions still apply. Revision 0 may remove all owned resources.
            Networking may be disrupted; intermediate states are visible. The clock starts before the response; explicit confirmation and out-of-band access may be necessary.
          </p>
          <ConfigDiff
            v-if="detail && store.state.data"
            :before="store.state.data.desired"
            :after="detail.config"
          />
          <p class="my-4">
            Required permissions (server authoritative): <span class="mono">{{ restorePermissions.join(", ") }}</span>
          </p>
          <v-text-field
            v-model="description"
            label="Optional restore description (blank uses server default)"
          />
          <v-text-field
            v-model="seconds"
            type="number"
            label="Confirmation seconds (10..300)"
          />
          <v-checkbox
            v-model="acknowledged"
            label="I reviewed complete replacement, drop/deletion risks, disruption, deadline, and recovery prerequisites."
          />
          <v-alert
            v-if="error"
            type="error"
          >
            {{ error }}
          </v-alert>
        </v-card-text>
        <v-card-actions class="flex-wrap">
          <v-btn
            :disabled="store.busy"
            @click="restoreDialog = false"
          >
            Cancel
          </v-btn>
          <v-btn
            color="warning"
            :disabled="!acknowledged || !canRestore"
            :loading="store.busy"
            @click="restore"
          >
            Restore provisionally
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>
