<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useTimestamps } from "@/composables/useTimestamps";
import { useControllerStore } from "@/stores/controller";
import { revisionSchema } from "@/types/domain";
import { useConfigExport } from "@/composables/useConfigExport";
import { differences, requiredPermissions } from "@/services/configuration";
import DatasetStatus from "@/components/base/DatasetStatus.vue";
import ConfigDiff from "@/components/feature/ConfigDiff.vue";
import JsonPanel from "@/components/base/JsonPanel.vue";
const { formatTimestamp, timeZone } = useTimestamps();
const props = defineProps<{ revision: string }>();
const store = useControllerStore(), router = useRouter();
const id = computed(() => props.revision);
const detail = computed(() => store.revisionDetail.data);
const compareID = ref(""), error = ref(""), restoreDialog = ref(false);
const comparison = computed(() => store.comparisonRevision.data?.config);
const seconds = ref<number | string>(120), description = ref(""), acknowledged = ref(false);
const { exportConfig, exportError } = useConfigExport();
const canRestore = computed(() => store.freshState && !store.draft && !store.submitted &&
  !store.busy && !store.uncertain);
const restorePermissions = computed(() => detail.value && store.state.data
  ? ["state.read", ...requiredPermissions(differences(store.state.data.desired, detail.value.config))] : []);
watch(id, async (value) => {
  error.value = ""; store.clearComparison(); compareID.value = "";
  if (value) {
    if (!revisionSchema.safeParse(value).success) { error.value = "Invalid uint64 revision"; return; }
    await store.loadRevision(value);
  }
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
    if (result) await router.push(`/config/commits/${encodeURIComponent(result.id)}`);
  } catch (failure) { error.value = failure instanceof Error ? failure.message : "Restore failed"; }
}
</script>
<template>
  <section aria-label="Revision detail">
    <h1 class="text-h6 mb-4">
      Revision {{ id }}
    </h1>
    <v-alert
      v-if="error || exportError"
      type="error"
      class="mb-4"
    >
      {{ error || exportError }}
    </v-alert>
    <DatasetStatus
      :query="store.revisionDetail"
      label="Historical revision"
    />
    <template v-if="detail && detail.revision === id">
      <div class="mb-5">
        <p
          v-if="detail.current"
          class="text-caption text-medium-emphasis mb-3"
        >
          Current revision
        </p>
        <p v-if="detail.description">
          {{ detail.description }}
        </p>
        <dl class="record-metadata">
          <template v-if="detail.submitted_at">
            <dt>Submitted ({{ timeZone }})</dt><dd>{{ formatTimestamp(detail.submitted_at) }}<span v-if="detail.submitted_by"> · {{ detail.submitted_by }}</span></dd>
          </template>
          <template v-if="detail.committed_at">
            <dt>Committed ({{ timeZone }})</dt><dd>{{ formatTimestamp(detail.committed_at) }}<span v-if="detail.committed_by"> · {{ detail.committed_by }}</span></dd>
          </template>
        </dl>
        <p v-if="detail.restored_from_revision !== undefined">
          Restored from revision {{ detail.restored_from_revision }}
        </p>
        <router-link
          v-if="detail.transaction_id"
          :to="`/config/commits/${encodeURIComponent(detail.transaction_id)}`"
        >
          Recorded commit
        </router-link>
      </div>
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
          to="/config/changes"
        >
          Review draft
        </v-btn>
      </v-alert>
      <h2 class="text-h5 mb-4">
        Compared with current revision
      </h2>
      <ConfigDiff
        v-if="store.state.data"
        :before="detail.config"
        :after="store.state.data.desired"
      />
      <div class="filter-grid">
        <v-text-field
          v-model="compareID"
          label="Compare revision"
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
        label="Configuration"
      />
    </template>
    <v-btn
      to="/config/revisions"
      variant="text"
    >
      All push requests
    </v-btn>
    <v-dialog
      v-model="restoreDialog"
      max-width="850"
      scrollable
      persistent
    >
      <v-card :title="`Restore revision ${id} provisionally`">
        <v-card-text>
          <p class="mb-4">
            Review the complete replacement/deletion impact. Historical key files may be unavailable and current restrictions still apply. Restoring an early revision may remove owned resources.
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
