<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { useControllerStore } from "@/stores/controller";
import type { Transaction } from "@/types/domain";
import { formatTimestamp } from "@/services/timestamps";
import DatasetStatus from "@/components/base/DatasetStatus.vue";
import TransactionActions from "@/components/feature/TransactionActions.vue";
import ConfigDiff from "@/components/feature/ConfigDiff.vue";
const props = defineProps<{ id: string }>();
const store = useControllerStore();
const detail = ref<Transaction | null>(null), loading = ref(false), error = ref("");
const current = computed(() => store.transactions.data?.[props.id] || detail.value);
const resultRevision = computed(() => current.value?.status === "committed" ? String(BigInt(current.value.base_revision) + 1n) : null);
let generation = 0, disposed = false;
async function read(): Promise<void> {
  const version = ++generation, target = props.id;
  error.value = ""; loading.value = true;
  const result = await store.readTransaction(target);
  if (version !== generation || disposed) return;
  loading.value = false;
  if (result) detail.value = result;
  else error.value = store.actionError || "Commit unavailable (possibly not found or denied)";
}
watch(() => props.id, () => { detail.value = null; void read(); }, { immediate: true });
onUnmounted(() => { disposed = true; generation++; });
</script>

<template>
  <section aria-label="Commit detail">
    <div class="d-flex align-center justify-space-between mb-4">
      <h1 class="text-h6 wrap-text mono">
        {{ id }}
      </h1>
      <v-btn
        icon="mdi-refresh"
        variant="text"
        aria-label="Refresh commit"
        title="Refresh commit"
        :loading="loading"
        :disabled="loading || store.busy"
        @click="read"
      />
    </div>
    <DatasetStatus
      :query="store.transactions"
      label="Independent commit discovery"
    />
    <v-progress-linear
      v-if="loading"
      indeterminate
    />
    <v-alert
      v-if="error"
      type="error"
      class="my-4"
    >
      {{ error }}
      <v-btn @click="read">
        Retry read
      </v-btn>
    </v-alert>
    <template v-if="current">
      <div class="mb-5">
        <dl class="record-metadata">
          <dt>Status</dt><dd><strong>{{ current.status }}</strong></dd>
          <dt>Base revision</dt><dd>
            <router-link :to="`/config/revisions/${current.base_revision}`">
              {{ current.base_revision }}
            </router-link>
          </dd>
          <template v-if="current.actor">
            <dt>Actor</dt><dd>{{ current.actor }}</dd>
          </template>
          <template v-if="current.submitted_at">
            <dt>Submitted (UTC)</dt><dd>{{ formatTimestamp(current.submitted_at) }}</dd>
          </template>
          <template v-if="current.committed_at">
            <dt>Committed (UTC)</dt><dd>{{ formatTimestamp(current.committed_at) }}<span v-if="current.committed_by"> · {{ current.committed_by }}</span></dd>
          </template>
        </dl>
        <p v-if="current.restored_from_revision !== undefined">
          Restored from
          <router-link :to="`/config/revisions/${current.restored_from_revision}`">
            {{ current.restored_from_revision }}
          </router-link>
        </p>
        <p v-if="resultRevision">
          Result revision
          <router-link :to="`/config/revisions/${resultRevision}`">
            {{ resultRevision }}
          </router-link>
        </p>
        <p
          v-if="current.description"
          class="my-3 wrap-text"
        >
          {{ current.description }}
        </p>
        <v-alert
          v-if="current.error"
          type="warning"
          class="my-4 wrap-text"
        >
          {{ current.error }}
        </v-alert>
        <TransactionActions :transaction="current" />
      </div>
      <ConfigDiff
        :before="current.previous"
        :after="current.candidate"
      />
    </template>
    <v-btn
      to="/config/commits"
      variant="text"
    >
      All commits
    </v-btn>
  </section>
</template>