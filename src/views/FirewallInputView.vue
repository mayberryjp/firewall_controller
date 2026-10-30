<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { ZodError } from "zod";
import { useControllerStore } from "@/stores/controller";
import { inputFirewallSchema } from "@/types/domain";
import type { Field } from "@/types/forms";
import { cloneConfig, stableJson, validateConfig } from "@/services/configuration";
import FieldInput from "@/components/base/FieldInput.vue";
import { interfaceChoice } from "@/services/resourceCollections";
import FirewallRuleTable from "@/components/feature/FirewallRuleTable.vue";
import FirewallCounterOverview from "@/components/feature/FirewallCounterOverview.vue";

const store = useControllerStore();
const selected = computed(() => store.draft ?? store.state.data?.active_transaction?.candidate ?? store.state.data?.desired);
const input = computed(() => selected.value?.firewall.input);
const dialog = ref(false), enabled = ref(false), form = ref<Record<string, unknown>>({});
const initial = ref(""), error = ref(""), errors = ref<Record<string, string[]>>({});
const snapshot = () => stableJson({ enabled: enabled.value, settings: form.value });
function reset(): void {
  enabled.value = Boolean(input.value);
  form.value = { policy: input.value?.policy ?? "drop" };
  initial.value = snapshot(); store.editorDirty = false; error.value = ""; errors.value = {};
}
watch(selected, () => { if (!dialog.value && !store.editorDirty) reset(); }, { immediate: true });
watch([enabled, form], () => { if (dialog.value) store.editorDirty = snapshot() !== initial.value; }, { deep: true });
onUnmounted(() => { store.editorDirty = false; });
const fields: Field[] = [
  { key: "policy", label: "Input default policy", kind: "select", choices: ["accept", "drop"].map(value => ({ title: value, value })) },
];
const selectedInterface = ref("");
const interfaceOptions = computed(() => [...new Set([
  ...(input.value?.interfaces.map(ingress => ingress.interface) ?? []),
  ...(selected.value?.interfaces.map(link => link.name) ?? []),
])].map(name => interfaceChoice(selected.value?.interfaces.find(link => link.name === name) ?? { name })));
watch(() => interfaceOptions.value.map(option => option.value), names => {
  if (!names.includes(selectedInterface.value)) selectedInterface.value = names[0] ?? "";
}, { immediate: true });
function cancel(): void { dialog.value = false; reset(); }
function stage(): void {
  error.value = ""; errors.value = {};
  try {
    if (!selected.value || store.readOnlyReason) throw new Error(store.readOnlyReason || "Configuration unavailable");
    const candidate = cloneConfig(selected.value);
    if (enabled.value) {
      candidate.firewall.input = inputFirewallSchema.parse({
        ...candidate.firewall.input,
        policy: form.value.policy,
        interfaces: candidate.firewall.input?.interfaces ?? [],
      });
    } else delete candidate.firewall.input;
    const issues = validateConfig(candidate, store.runtime.data?.parent_interfaces, store.state.data?.desired).filter(issue => issue.path.startsWith("firewall.input"));
    for (const issue of issues) errors.value[issue.path.replace("firewall.input", "editor")] = [issue.message];
    if (issues.length) throw new Error(issues.map(issue => issue.message).join("; "));
    store.stage(candidate); cancel();
  } catch (failure) {
    if (failure instanceof ZodError) {
      for (const issue of failure.issues) errors.value[`editor.${issue.path.join(".")}`] = [issue.message];
      error.value = failure.issues.map(issue => issue.message).join("; ");
    } else error.value = failure instanceof Error ? failure.message : "Unable to stage input policy";
  }
}
</script>

<template>
  <section aria-label="Firewall destined">
    <v-progress-linear
      v-if="store.state.loading && !store.state.data"
      indeterminate
    />
    <v-alert
      v-if="store.readOnlyNotice"
      type="warning"
      class="mb-4"
    >
      {{ store.readOnlyNotice }}
    </v-alert>
    <div
      v-if="!dialog"
      class="d-flex flex-wrap align-center ga-3 mb-4"
    >
      <v-select
        v-if="input"
        v-model="selectedInterface"
        label="Interface"
        :items="interfaceOptions"
        :disabled="!interfaceOptions.length || store.editorDirty"
        variant="outlined"
        density="compact"
        hide-details
        class="flex-grow-1"
      />
      <v-btn
        :prepend-icon="input ? 'mdi-pencil' : 'mdi-plus'"
        :disabled="!selected || Boolean(store.readOnlyReason) || store.editorDirty"
        variant="text"
        size="small"
        @click="reset(); dialog = true"
      >
        {{ input ? "Edit input policy" : "Add input policy" }}
      </v-btn>
    </div>
    <template v-if="input && !dialog">
      <FirewallRuleTable
        v-if="selectedInterface"
        :key="selectedInterface"
        scope="input"
        :owner="selectedInterface"
      />
    </template>
    <p
      v-else-if="selected && !input && !dialog"
      class="text-medium-emphasis"
    >
      No host input filter configured.
    </p>
    <FirewallCounterOverview
      v-if="!dialog && (!input || !selectedInterface)"
      chain="input"
    />
    <v-card
      v-if="dialog"
      title="Firewall destined policy"
    >
      <v-card-text>
        <v-switch
          v-model="enabled"
          label="Input filtering"
          hide-details
          color="primary"
          class="mb-4"
        />
        <v-alert
          v-if="input && !enabled"
          type="warning"
          class="mb-4"
        >
          Removing input filtering removes host protection, including WAN protection.
        </v-alert>
        <FieldInput
          v-for="field in enabled ? fields : []"
          :key="field.key"
          :field="field"
          :model-value="form[field.key]"
          :path="`editor.${field.key}`"
          :errors="errors"
          @update:model-value="form = { ...form, [field.key]: $event }"
        />
        <v-alert
          v-if="error"
          type="error"
          role="alert"
          class="mt-4"
        >
          {{ error }}
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-btn @click="cancel">
          Cancel
        </v-btn>
        <v-btn
          color="primary"
          :disabled="Boolean(store.readOnlyReason)"
          @click="stage"
        >
          Save
        </v-btn>
      </v-card-actions>
    </v-card>
  </section>
</template>
