<script setup lang="ts">
import { computed, ref } from "vue";
import { useControllerStore } from "@/stores/controller";
import TransactionActions from "@/components/feature/TransactionActions.vue";
import JsonPanel from "@/components/base/JsonPanel.vue";
const store = useControllerStore();
const reconciliation = ref(false), error = ref("");
const candidates = computed(() => store.uncertain ? store.sortedTransactions.filter(item =>
  !store.uncertain!.priorIDs.includes(item.id)) : []);
function resolve(): void {
  try { store.resolveUncertainty(); reconciliation.value = false; error.value = ""; }
  catch (failure) { error.value = failure instanceof Error ? failure.message : "Reconciliation failed"; }
}
</script>
<template>
  <section
    aria-label="Global safety state"
    class="mb-6"
  >
    <v-alert
      v-if="store.incompatible"
      type="error"
      variant="tonal"
      class="mb-3"
    >
      Incompatible response or unknown transaction state. Unsafe editing/lifecycle assumptions are disabled. Keep read-only diagnostics and contact the operator.
    </v-alert>
    <v-alert
      v-if="store.uncertain"
      type="error"
      variant="tonal"
      class="mb-3"
    >
      <strong>Outcome unknown: {{ store.uncertain.operation }}.</strong>
      Do not replay the write. A browser disconnect or timeout does not cancel durable intent.
      <p>Started {{ store.uncertain.startedAt }} · base {{ store.uncertain.base ?? "Unknown" }}</p>
      <p>New transaction records are correlation hints, not proof of ownership.</p>
      <v-btn
        v-if="store.uncertain.id"
        class="my-2"
        :to="`/transactions/${encodeURIComponent(store.uncertain.id)}`"
      >
        Inspect known transaction
      </v-btn>
      <JsonPanel
        :value="candidates"
        label="Plausible new transactions (operator reconciliation required)"
      />
      <v-checkbox
        v-model="reconciliation"
        label="I reviewed fresh server state and transaction records and established the outcome."
      />
      <v-btn
        :disabled="!reconciliation || store.busy"
        @click="resolve"
      >
        Acknowledge reconciled outcome
      </v-btn>
      <p
        v-if="error"
        role="alert"
      >
        {{ error }}
      </p>
    </v-alert>
    <v-alert
      v-for="transaction in store.activeTransactions"
      :key="transaction.id"
      :type="transaction.status === 'recovery_failed' ? 'error' : 'warning'"
      variant="tonal"
      class="mb-3"
    >
      <strong>{{ transaction.status === "recovery_failed" ? "Critical: recovery failed" : transaction.status.replaceAll("_", " ") }}</strong>
      <p class="mono">
        {{ transaction.id }}
      </p>
      <p
        v-if="transaction.error"
        class="wrap-text"
      >
        {{ transaction.error }}
      </p>
      <TransactionActions :transaction="transaction" />
    </v-alert>
    <v-alert
      v-if="store.state.error || store.state.stale || store.transactions.stale"
      type="warning"
      variant="tonal"
      class="mb-3"
    >
      Committed observation or transaction discovery is unavailable/stale. New applies and restores are blocked.
      <p v-if="store.state.error">
        {{ store.state.error }}
      </p>
      <p v-if="store.transactions.error">
        {{ store.transactions.error }}
      </p>
      <p>Last committed read: {{ store.state.lastSuccess ? new Date(store.state.lastSuccess).toLocaleString() : "Unknown" }}.</p>
      <v-btn
        variant="text"
        to="/transactions"
      >
        Recovery diagnostics
      </v-btn>
    </v-alert>
    <v-alert
      v-if="store.state.data?.drift"
      type="warning"
      variant="tonal"
      class="mb-3"
    >
      Modeled drift detected. Expected live state differs from observation. No force apply or automatic repair is available.
      <v-btn
        variant="text"
        to="/overview"
      >
        Inspect comparison
      </v-btn>
    </v-alert>
    <v-alert
      v-if="store.draftStale"
      type="warning"
      variant="tonal"
      class="mb-3"
    >
      Draft base {{ store.baseRevision }} differs from latest committed revision. Export/compare and explicitly restart; no automatic rebase.
    </v-alert>
    <v-alert
      v-if="store.actionError"
      type="error"
      variant="tonal"
      class="mb-3"
    >
      {{ store.actionError }}
    </v-alert>
    <v-alert
      v-if="store.notice"
      type="info"
      variant="tonal"
      class="mb-3"
      closable
      @click:close="store.notice = null"
    >
      {{ store.notice }}
    </v-alert>
  </section>
</template>
