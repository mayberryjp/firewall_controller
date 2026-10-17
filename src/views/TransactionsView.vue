<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useControllerStore } from "@/stores/controller";
import type { Transaction } from "@/types/domain";
import DatasetStatus from "@/components/base/DatasetStatus.vue";
import TransactionActions from "@/components/feature/TransactionActions.vue";
import ConfigDiff from "@/components/feature/ConfigDiff.vue";
import JsonPanel from "@/components/base/JsonPanel.vue";
const store = useControllerStore(), route = useRoute();
const search = ref(""), status = ref("All"), page = ref(1), detail = ref<Transaction | null>(null), loading = ref(false), error = ref("");
const id = computed(() => typeof route.params.id === "string" ? route.params.id : "");
const filtered = computed(() => store.sortedTransactions.filter(item =>
  (status.value === "All" || item.status === status.value) && JSON.stringify(item).toLowerCase().includes(search.value.toLowerCase())));
const current = computed(() => (id.value && store.transactions.data?.[id.value]) || detail.value);
const resultRevision = computed(() => current.value?.status === "committed" ? String(BigInt(current.value.base_revision) + 1n) : null);
let timer: ReturnType<typeof setTimeout> | undefined;
let generation = 0, disposed = false;
async function read(): Promise<void> {
  const version = ++generation, target = id.value;
  clearTimeout(timer); error.value = "";
  if (!target) { await store.refreshTransactions(); return; }
  loading.value = true;
  const result = await store.readTransaction(target);
  if (version !== generation || disposed) return;
  loading.value = false;
  if (result) detail.value = result;
  else error.value = store.actionError || "Transaction unavailable (possibly not found or denied)";
  if (store.connected && document.visibilityState !== "hidden") timer = setTimeout(() => { void read(); }, result && ["committed", "rolled_back"].includes(result.status) ? 10000 : 1000);
}
watch(id, () => { detail.value = null; void read(); }, { immediate: true });
onUnmounted(() => { disposed = true; generation++; clearTimeout(timer); });
</script>
<template>
  <section>
    <h1 class="text-h4 mb-4">
      {{ id ? "Transaction detail" : "Transactions" }}
    </h1>
    <p class="mb-4">
      Journal metadata is not a full audit-event log. Browser closure is not a rollback mechanism; restart recovery and watchdog behavior depend on daemon availability.
    </p>
    <DatasetStatus
      :query="store.transactions"
      label="Independent transaction discovery"
    />
    <template v-if="id">
      <v-progress-linear
        v-if="loading"
        indeterminate
      />
      <v-alert
        v-if="error"
        type="error"
        class="my-4"
      >
        {{ error }}<v-btn @click="read">
          Retry read
        </v-btn>
      </v-alert>
      <template v-if="current">
        <v-card
          border
          class="pa-5 mb-5"
        >
          <h2 class="text-h6 wrap-text mono">
            {{ current.id }}
          </h2><p class="my-3">
            Server status: <strong>{{ current.status }}</strong>
          </p>
          <p>
            Actor: {{ current.actor || "Unknown" }} · base revision <router-link :to="`/history/${current.base_revision}`">
              {{ current.base_revision }}
            </router-link>
          </p>
          <p>Submitted {{ current.submitted_at || "Unknown (legacy record)" }}</p>
          <p>Committed {{ current.committed_at || "Unknown (legacy record)" }} · by {{ current.committed_by || "Unknown" }}</p>
          <p v-if="current.restored_from_revision !== undefined">
            Restored from <router-link :to="`/history/${current.restored_from_revision}`">
              {{ current.restored_from_revision }}
            </router-link>
          </p>
          <p v-if="resultRevision">
            Result revision <router-link :to="`/history/${resultRevision}`">
              {{ resultRevision }}
            </router-link> (base + 1, not necessarily latest)
          </p>
          <p class="my-3 wrap-text">
            {{ current.description || "No description" }}
          </p>
          <v-alert
            v-if="current.error"
            type="warning"
            class="my-4 wrap-text"
          >
            {{ current.error }}
          </v-alert>
          <TransactionActions :transaction="current" />
        </v-card>
        <h2 class="text-h5">
          Previous versus frozen candidate
        </h2>
        <ConfigDiff
          :before="current.previous"
          :after="current.candidate"
        />
        <JsonPanel
          :value="current"
          label="Read-only recorded transaction (unknown metadata remains unknown)"
        />
      </template>
      <v-btn
        to="/transactions"
        variant="text"
      >
        All transactions
      </v-btn>
    </template>
    <template v-else>
      <div class="filter-grid">
        <v-text-field
          v-model="search"
          label="Filter transaction text"
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
        <thead><tr><th>Status / ID</th><th>Description / actor</th><th>Submitted</th><th>Base revision</th><th>Committed / by</th><th>Provenance / deadline</th></tr></thead>
        <tbody>
          <tr
            v-for="item in filtered.slice((page - 1) * 20, page * 20)"
            :key="item.id"
          >
            <td>
              {{ item.status }}<br><router-link
                class="mono"
                :to="`/transactions/${encodeURIComponent(item.id)}`"
              >
                {{ item.id }}
              </router-link>
            </td>
            <td>{{ item.description || "No description" }}<br>{{ item.actor || "Unknown" }}</td>
            <td>{{ item.submitted_at || "Unknown-date group (legacy record)" }}</td><td class="mono">
              {{ item.base_revision }}
            </td>
            <td>{{ item.committed_at || "Unknown (legacy record)" }}<br>{{ item.committed_by || "Unknown" }}</td>
            <td>Restore source {{ item.restored_from_revision ?? "None" }}<br>{{ item.status === "pending_confirmation" ? item.confirmation_deadline : "No pending deadline" }}</td>
          </tr><tr v-if="!filtered.length">
            <td colspan="6">
              No matching transaction records.
            </td>
          </tr>
        </tbody>
      </v-table>
      <v-pagination
        v-if="filtered.length > 20"
        v-model="page"
        :length="Math.ceil(filtered.length / 20)"
      />
    </template>
  </section>
</template>
