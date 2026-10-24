<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useControllerStore } from "@/stores/controller";
import ConfigDiff from "@/components/feature/ConfigDiff.vue";
import { requiredPermissions } from "@/services/configuration";

const open = defineModel<boolean>({ required: true });
const props = withDefaults(defineProps<{ seconds?: number | string; description?: string; editOptions?: boolean }>(), {
  seconds: 120, description: "", editOptions: false,
});
const store = useControllerStore(), router = useRouter();
const acknowledged = ref(false), dropAcknowledged = ref(false), error = ref("");
const confirmationSeconds = ref<number | string>(120), saveDescription = ref("");
const dropRisk = computed(() => store.draft?.firewall.policy === "drop" || store.draft?.firewall.rules.some(rule => rule.action === "drop" && !rule.source && !rule.destination) ||
  store.draft?.firewall.input?.policy === "drop" || store.draft?.firewall.input?.interfaces.some(ingress => ingress.rules.some(rule => rule.action === "drop" && !rule.destination && !rule.protocol && !rule.destination_ports?.length)));
watch(open, value => {
  if (!value) return;
  acknowledged.value = false; dropAcknowledged.value = false; error.value = "";
  confirmationSeconds.value = props.seconds; saveDescription.value = props.description;
}, { immediate: true });
async function apply(): Promise<void> {
  if (!acknowledged.value || (dropRisk.value && !dropAcknowledged.value) || !store.canApply || store.editorDirty) return;
  try {
    error.value = "";
    const transaction = await store.apply(Number(props.editOptions ? confirmationSeconds.value : props.seconds), props.editOptions ? saveDescription.value : props.description);
    open.value = false;
    if (transaction) await router.push(`/transactions/${encodeURIComponent(transaction.id)}`);
  } catch (failure) { error.value = failure instanceof Error ? failure.message : "Unable to save configuration"; }
}
</script>

<template>
  <v-dialog
    v-model="open"
    max-width="900"
    persistent
    scrollable
  >
    <v-card title="Apply complete configuration provisionally">
      <v-card-text>
        <p class="mb-4">
          This replaces all owned configuration, including deletions. Networking can be disrupted and intermediate states are visible; it is not an atomic kernel transaction.
          The confirmation clock starts before the response. Confirm explicitly before the server deadline. Out-of-band access and operator-managed forwarding may be necessary.
        </p>
        <v-alert
          v-if="store.editorDirty"
          type="warning"
          class="mb-4"
        >
          There is unstaged form input. Cancel and stage the current form before saving the shared draft.
        </v-alert>
        <v-alert
          v-if="!store.canApply"
          type="warning"
          class="mb-4"
        >
          Save blocked: resolve validation, empty changes, stale/unavailable discovery, stale base, drift, active transaction, or frozen/uncertain write.
          <v-btn
            to="/changes"
            variant="text"
            :disabled="store.editorDirty || store.busy"
            @click="open = false"
          >
            Review changes
          </v-btn>
        </v-alert>
        <ConfigDiff
          v-if="store.baseline && store.draft"
          :before="store.baseline"
          :after="store.draft"
        />
        <template v-if="editOptions">
          <v-text-field
            v-model="saveDescription"
            label="Description"
          />
          <v-text-field
            v-model="confirmationSeconds"
            type="number"
            label="Confirmation window (seconds)"
            min="10"
            max="300"
          />
        </template>
        <p class="text-caption text-medium-emphasis mb-4">
          Required permissions: {{ requiredPermissions(store.diff).join(", ") }}
        </p>
        <v-alert
          v-if="error"
          type="error"
          role="alert"
          class="mb-4"
        >
          {{ error }}
        </v-alert>
        <v-checkbox
          v-model="acknowledged"
          label="I reviewed the complete package, deletion impact, disruption risk, deadline, and recovery prerequisites."
        />
        <v-checkbox
          v-if="dropRisk"
          v-model="dropAcknowledged"
          label="I explicitly acknowledge default drop / catch-all drop and potentially unreachable later rules."
        />
      </v-card-text>
      <v-card-actions class="flex-wrap">
        <v-btn
          :disabled="store.busy"
          @click="open = false"
        >
          Cancel
        </v-btn>
        <v-btn
          color="warning"
          :loading="store.busy"
          :disabled="!acknowledged || (dropRisk && !dropAcknowledged) || !store.canApply || store.editorDirty"
          @click="apply"
        >
          Apply provisionally
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>