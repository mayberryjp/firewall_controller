<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import { useControllerStore } from "@/stores/controller";
import type { Transaction } from "@/types/domain";
import { formatTimestamp } from "@/services/timestamps";
const props = withDefaults(defineProps<{ transaction: Transaction; showDetails?: boolean }>(), { showDetails: true });
const emit = defineEmits<{ updated: [transaction: Transaction] }>();
const store = useControllerStore();
const now = ref(Date.now()), dialog = ref<"rollback" | null>(null);
const error = ref<string | null>(null);
const timer = setInterval(() => { now.value = Date.now(); }, 1000);
onUnmounted(() => clearInterval(timer));
const remaining = computed(() => Math.max(0, Math.ceil((Date.parse(props.transaction.confirmation_deadline) - now.value) / 1000)));
async function execute(action: "confirm" | "rollback"): Promise<void> {
  if (store.busy || store.incompatible || (action === "confirm" && (!remaining.value || props.transaction.status !== "pending_confirmation"))) return;
  error.value = null;
  try {
    const result = await store.lifecycle(props.transaction.id, action);
    if (result) emit("updated", result);
    else error.value = store.actionError || "Unable to verify the operation. Check the commit status before trying again.";
    dialog.value = null;
  }
  catch (failure) { error.value = failure instanceof Error ? failure.message : "Lifecycle operation failed"; }
}
</script>
<template>
  <div class="transaction-actions">
    <v-alert
      v-if="error"
      type="error"
      role="alert"
      class="my-3"
    >
      {{ error }}
    </v-alert>
    <p
      v-if="transaction.status === 'pending_confirmation'"
      class="my-2"
    >
      Confirm before automatic rollback: <time
        :datetime="transaction.confirmation_deadline"
        :title="`${formatTimestamp(transaction.confirmation_deadline)} UTC`"
      >{{ formatTimestamp(transaction.confirmation_deadline) }}</time> UTC
      · {{ remaining ? `${remaining}s remaining` : "Deadline reached; awaiting server outcome" }}
    </p>
    <div class="d-flex flex-wrap ga-2">
      <v-btn
        v-if="transaction.status === 'pending_confirmation'"
        color="success"
        :disabled="!remaining || store.busy || store.incompatible"
        @click="execute('confirm')"
      >
        Confirm changes
      </v-btn>
      <v-btn
        v-if="['pending_confirmation', 'recovery_failed'].includes(transaction.status)"
        color="error"
        variant="outlined"
        :disabled="store.busy || store.incompatible"
        @click="dialog = 'rollback'"
      >
        {{ transaction.status === "recovery_failed" ? "Retry rollback" : "Roll back" }}
      </v-btn>
      <v-btn
        v-if="showDetails"
        :to="`/config/commits/${encodeURIComponent(transaction.id)}`"
        variant="text"
      >
        Commit details
      </v-btn>
    </div>
    <v-dialog
      :model-value="dialog !== null"
      max-width="620"
      @update:model-value="!$event && (dialog = null)"
    >
      <v-card title="Restore previous configuration">
        <v-card-text>
          <p>
            Restore modeled configuration. This does not recover packets, connections, handshakes, flow caches, exported records, or other external state.
          </p>
        </v-card-text>
        <v-card-actions class="flex-wrap">
          <v-btn @click="dialog = null">
            Cancel
          </v-btn>
          <v-btn
            color="error"
            :loading="store.busy"
            :disabled="store.busy || store.incompatible"
            @click="execute('rollback')"
          >
            Roll back configuration
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
