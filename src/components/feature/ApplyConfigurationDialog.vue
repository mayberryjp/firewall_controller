<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useControllerStore } from "@/stores/controller";
import { requiredPermissions } from "@/services/configuration";
import type { Transaction } from "@/types/domain";
import TransactionActions from "@/components/feature/TransactionActions.vue";

const open = defineModel<boolean>({ required: true });
const props = withDefaults(defineProps<{ seconds?: number | string; description?: string; editOptions?: boolean }>(), {
  seconds: 120, description: "", editOptions: false,
});
const store = useControllerStore(), router = useRouter();
const error = ref("");
const confirmationSeconds = ref<number | string>(120), saveDescription = ref("");
const pushed = ref<Transaction | null>(null);
const current = computed(() => pushed.value ? store.transactions.data?.[pushed.value.id] ?? pushed.value : null);
const monitorFailure = computed(() => Boolean(error.value || current.value?.error) &&
  (current.value?.candidate ?? store.draft)?.gateway_monitors.some(monitor => monitor.enabled));
let timer: ReturnType<typeof setTimeout> | undefined, generation = 0, failures = 0;
function stopReading(): void { generation++; clearTimeout(timer); }
function scheduleRead(): void {
  clearTimeout(timer);
  if (!open.value || !store.connected || !current.value || !["applying", "pending_confirmation", "rolling_back"].includes(current.value.status)) return;
  const version = generation, id = current.value.id;
  timer = setTimeout(async () => {
    if (version !== generation) return;
    if (store.busy || document.visibilityState === "hidden") { scheduleRead(); return; }
    const result = await store.readTransaction(id);
    if (version !== generation) return;
    if (result) { pushed.value = result; error.value = ""; failures = 0; }
    else { error.value = store.actionError || "Unable to check push status"; failures++; }
    scheduleRead();
  }, Math.min(30000, 2000 * 2 ** Math.min(failures, 4)));
}
watch([open, () => pushed.value?.id, () => current.value?.status, () => store.connected], () => { stopReading(); failures = 0; scheduleRead(); });
onUnmounted(stopReading);
watch(open, value => {
  if (!value) return;
  error.value = ""; pushed.value = null;
  confirmationSeconds.value = props.seconds; saveDescription.value = props.description;
}, { immediate: true });
watch([open, () => current.value?.status, () => store.busy], () => {
  if (open.value && current.value?.status === "committed" && !store.busy) void close();
});
async function apply(): Promise<void> {
  if (!store.canApply || store.editorDirty) return;
  try {
    error.value = "";
    const transaction = await store.apply(Number(props.editOptions ? confirmationSeconds.value : props.seconds), props.editOptions ? saveDescription.value : props.description);
    if (transaction) pushed.value = transaction;
    else error.value = store.actionError || "Push outcome could not be verified. Check Commits before trying again.";
  } catch (failure) { error.value = failure instanceof Error ? failure.message : "Unable to push changes"; }
}
async function close(): Promise<void> {
  open.value = false;
  if (current.value) await router.push(`/config/commits/${encodeURIComponent(current.value.id)}`);
}
</script>

<template>
  <v-dialog
    v-model="open"
    max-width="900"
    persistent
    scrollable
  >
    <v-card title="Push changes">
      <v-card-text>
        <template v-if="current">
          <v-alert
            v-if="store.ignoredFields.length"
            type="warning"
            variant="tonal"
            class="mb-3"
          >
            The firewall ignored unrecognized settings, so they are not applied: {{ store.ignoredFields.join(', ') }}
          </v-alert>
          <v-alert
            v-if="current.status === 'committed'"
            type="success"
          >
            Changes confirmed.
          </v-alert>
          <v-alert
            v-else-if="current.status === 'rolled_back'"
            type="warning"
          >
            Changes rolled back.
          </v-alert>
          <template v-else>
            <p
              class="mb-3"
              role="status"
            >
              {{ current.status === 'pending_confirmation' ? 'Changes applied.' : current.status.replaceAll('_', ' ') }}
            </p>
            <TransactionActions
              :transaction="current"
              :show-details="false"
              @updated="pushed = $event"
            />
          </template>
          <v-alert
            v-if="current.error"
            type="error"
            role="alert"
            class="mb-3 push-diagnostic"
          >
            {{ current.error }}
          </v-alert>
        </template>
        <template v-else>
          <p class="mb-4">
            Push all changes, including deletions, to the firewall. This can interrupt network access.
            Test connectivity, then confirm the push before the deadline or the firewall will restore its previous configuration.
            The deadline starts when the firewall begins applying changes. Keep another way to access the firewall if connectivity is lost.
          </p>
          <v-alert
            v-if="store.editorDirty"
            type="warning"
            class="mb-4"
          >
            There is unstaged form input. Cancel and stage those edits before pushing.
          </v-alert>
          <v-alert
            v-if="!store.canApply"
            type="warning"
            class="mb-4"
          >
            Push blocked: {{ store.applyBlockedReason }}
            <v-btn
              to="/config/changes"
              variant="text"
              :disabled="store.editorDirty || store.busy"
              @click="open = false"
            >
              SAVE
            </v-btn>
          </v-alert>
          <template v-if="editOptions">
            <v-text-field
              v-model="saveDescription"
              label="Commit message"
            />
            <v-text-field
              v-model="confirmationSeconds"
              type="number"
              label="Auto-rollback after (seconds)"
              min="10"
              max="300"
            />
          </template>
          <p class="text-caption text-medium-emphasis mb-4">
            Required permissions: {{ requiredPermissions(store.diff).join(", ") }}
          </p>
        </template>
        <v-alert
          v-if="error"
          type="error"
          role="alert"
          class="mb-4 push-diagnostic"
        >
          {{ error }}
        </v-alert>
        <details
          v-if="monitorFailure"
          class="monitor-prerequisites mb-4"
        >
          <summary>Gateway monitoring prerequisites</summary>
          <p class="mt-2 mb-2">
            Host monitoring requires both <code>--allow-host-services</code> and <code>--gateway-monitoring</code>.
            <code>--appliance</code> alone is insufficient; the shipped service unit enables neither opt-in.
          </p>
          <p class="mb-2">
            An operator must review other configured host services, preserve existing startup flags,
            and keep independent OS SSH or console access. Restart only with no active transaction or upgrade.
          </p>
          <p>
            After operator enablement, verify connectivity and refresh committed state and revision before an explicit retry.
            Review the transaction outcome first; a failed recovery must be resolved before another push.
            Do not disable monitors or add static routes or lease addresses to work around a DHCP monitor failure.
          </p>
        </details>
      </v-card-text>
      <v-card-actions class="flex-wrap">
        <v-btn
          v-if="current"
          :disabled="store.busy"
          @click="close"
        >
          {{ ['committed', 'rolled_back'].includes(current.status) ? 'Done' : 'Close' }}
        </v-btn>
        <template v-else>
          <v-btn
            :disabled="store.busy"
            @click="open = false"
          >
            Cancel
          </v-btn>
          <v-btn
            color="warning"
            :loading="store.busy"
            :disabled="!store.canApply || store.editorDirty"
            @click="apply"
          >
            Push changes
          </v-btn>
        </template>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.push-diagnostic { white-space: pre-wrap; overflow-wrap: anywhere; }
.monitor-prerequisites { overflow-wrap: anywhere; }
.monitor-prerequisites summary { cursor: pointer; }
</style>