<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import { useControllerStore } from "@/stores/controller";
import type { Transaction } from "@/types/domain";
const props = defineProps<{ transaction: Transaction }>();
const store = useControllerStore();
const now = ref(Date.now()), dialog = ref<"confirm" | "rollback" | null>(null), acknowledged = ref(false);
const error = ref<string | null>(null);
const timer = setInterval(() => { now.value = Date.now(); }, 1000);
onUnmounted(() => clearInterval(timer));
const remaining = computed(() => Math.max(0, Math.ceil((Date.parse(props.transaction.confirmation_deadline) - now.value) / 1000)));
async function execute(): Promise<void> {
  if (!dialog.value) return;
  error.value = null;
  try { await store.lifecycle(props.transaction.id, dialog.value); dialog.value = null; acknowledged.value = false; }
  catch (failure) { error.value = failure instanceof Error ? failure.message : "Lifecycle operation failed"; }
}
</script>
<template>
  <div class="transaction-actions">
    <p
      v-if="transaction.status === 'pending_confirmation'"
      class="my-2"
    >
      Deadline: <time
        :datetime="transaction.confirmation_deadline"
        :title="transaction.confirmation_deadline"
      >{{ new Date(transaction.confirmation_deadline).toLocaleString() }}</time>
      · {{ remaining ? `${remaining}s remaining` : "Deadline reached; awaiting server outcome" }}
    </p>
    <div class="d-flex flex-wrap ga-2">
      <v-btn
        v-if="transaction.status === 'pending_confirmation'"
        color="success"
        :disabled="!remaining || store.busy || store.incompatible"
        @click="dialog = 'confirm'; acknowledged = false"
      >
        Confirm configuration
      </v-btn>
      <v-btn
        v-if="['pending_confirmation', 'recovery_failed'].includes(transaction.status)"
        color="error"
        variant="outlined"
        :disabled="store.busy || store.incompatible"
        @click="dialog = 'rollback'; acknowledged = false"
      >
        {{ transaction.status === "recovery_failed" ? "Retry rollback" : "Roll back" }}
      </v-btn>
      <v-btn
        :to="`/transactions/${encodeURIComponent(transaction.id)}`"
        variant="text"
      >
        Transaction details
      </v-btn>
    </div>
    <v-dialog
      :model-value="dialog !== null"
      max-width="620"
      @update:model-value="!$event && (dialog = null)"
    >
      <v-card :title="dialog === 'confirm' ? 'Confirm configuration' : 'Restore previous configuration'">
        <v-card-text>
          <p v-if="dialog === 'confirm'">
            The backend does not test reachability. Confirm only after your connectivity checks. This explicitly publishes a committed revision.
          </p>
          <p v-else>
            Restore modeled configuration. This does not recover packets, connections, handshakes, flow caches, exported records, or other external state.
          </p>
          <v-checkbox
            v-if="dialog === 'confirm'"
            v-model="acknowledged"
            label="I have checked connectivity and want to commit this candidate."
          />
          <v-alert
            v-if="error"
            type="error"
            class="mt-3"
          >
            {{ error }}
          </v-alert>
        </v-card-text>
        <v-card-actions class="flex-wrap">
          <v-btn @click="dialog = null">
            Cancel
          </v-btn>
          <v-btn
            :color="dialog === 'confirm' ? 'success' : 'error'"
            :loading="store.busy"
            :disabled="dialog === 'confirm' && (!acknowledged || !remaining)"
            @click="execute"
          >
            {{ dialog === "confirm" ? "Confirm configuration" : "Roll back configuration" }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
