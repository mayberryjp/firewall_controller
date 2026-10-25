<script setup lang="ts">
import { computed, onMounted, ref, useId, watch } from "vue";
import FieldInput from "@/components/base/FieldInput.vue";
import type { Field } from "@/types/forms";

const props = defineProps<{
  title: string;
  form: Record<string, unknown>;
  fields: Field[];
  keys: string[];
  columns: number;
  errors: Record<string, string[]>;
  error: string;
  disabled: boolean;
  collapseOptions?: boolean;
}>();
const emit = defineEmits<{ change: [key: string, value: unknown]; cancel: []; stage: [] }>();
const row = ref<HTMLTableRowElement | null>(null);
const inputs = computed(() => props.keys.map(key => props.fields.find(field => field.key === key)).filter((field): field is Field => Boolean(field)));
const options = computed(() => props.fields.filter(field => !props.keys.includes(field.key)));
const showAdvanced = ref(false);
const optionsId = useId();
watch(() => options.value.some(field => Object.keys(props.errors).some(path =>
  path === `editor.${field.key}` || path.startsWith(`editor.${field.key}.`))), hasErrors => {
  if (hasErrors) showAdvanced.value = true;
}, { immediate: true });
onMounted(() => {
  row.value?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  row.value?.querySelector("input")?.focus();
});
</script>

<template>
  <tr
    ref="row"
    class="resource-editor-row"
    :aria-label="`${title} editor`"
    @keydown.esc.prevent="emit('cancel')"
  >
    <td
      v-for="field in inputs"
      :key="field.key"
      :class="{ 'probe-target-cell': collapseOptions && field.key === 'target' }"
    >
      <span
        class="compact-cell-label"
        aria-hidden="true"
      >{{ field.label }}</span>
      <v-switch
        v-if="field.kind === 'switch'"
        :model-value="form[field.key] === true"
        :aria-label="field.label"
        :disabled="disabled || field.disabled"
        :error-messages="errors[`editor.${field.key}`]"
        density="compact"
        color="primary"
        hide-details="auto"
        @update:model-value="emit('change', field.key, Boolean($event))"
      />
      <div
        v-else
        :class="{ 'probe-target-controls': collapseOptions && field.key === 'target' }"
      >
        <FieldInput
          :field="{ ...field, disabled: disabled || field.disabled }"
          :model-value="form[field.key]"
          :path="`editor.${field.key}`"
          :errors="errors"
          density="compact"
          variant="outlined"
          @update:model-value="emit('change', field.key, $event)"
        />
        <v-btn
          v-if="collapseOptions && field.key === 'target' && options.length"
          variant="text"
          size="small"
          :append-icon="showAdvanced ? 'mdi-chevron-up' : 'mdi-chevron-down'"
          :aria-expanded="showAdvanced"
          :aria-controls="optionsId"
          @click="showAdvanced = !showAdvanced"
        >
          {{ showAdvanced ? "Hide advanced" : "Show advanced" }}
        </v-btn>
      </div>
    </td>
    <td>
      <div class="editor-actions">
        <v-btn
          color="primary"
          size="small"
          :disabled="disabled"
          @click="emit('stage')"
        >
          Save
        </v-btn>
        <v-btn
          variant="text"
          size="small"
          @click="emit('cancel')"
        >
          Cancel
        </v-btn>
      </div>
    </td>
  </tr>
  <tr
    v-if="options.length"
    v-show="!collapseOptions || showAdvanced"
    :aria-label="`${title} options`"
    @keydown.esc.prevent="emit('cancel')"
  >
    <td :colspan="columns">
      <div
        v-show="!collapseOptions || showAdvanced"
        :id="optionsId"
        class="resource-editor-options"
      >
        <FieldInput
          v-for="field in options"
          :key="field.key"
          :field="{ ...field, disabled: disabled || field.disabled }"
          :model-value="form[field.key]"
          :path="`editor.${field.key}`"
          :errors="errors"
          density="compact"
          variant="outlined"
          @update:model-value="emit('change', field.key, $event)"
        />
      </div>
    </td>
  </tr>
  <tr v-if="error">
    <td :colspan="columns">
      <p
        role="alert"
        class="text-error py-2"
      >
        {{ Object.values(errors).flat().join('; ') || error }}
      </p>
    </td>
  </tr>
</template>

<style scoped>
.compact-cell-label { display: none; }
.editor-actions { display: flex; flex-direction: column; gap: 4px; }
.probe-target-controls { display: flex; align-items: flex-start; gap: 8px; }
.probe-target-controls > :deep(.v-input) { flex: 1 1 0; }
.probe-target-controls > .v-btn { flex: 0 0 auto; margin-top: 4px; }
.resource-editor-options { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr)); gap: 12px; padding-block: 8px; }
.resource-editor-options > :deep(fieldset) { grid-column: 1 / -1; }
.resource-editor-row :deep(.v-input), .resource-editor-options :deep(.v-input) { min-width: 0; }
.resource-editor-row :deep(.v-field__input), .resource-editor-options :deep(.v-field__input) { min-width: 0; padding-inline: 8px; font-size: 13px; }
.resource-editor-row :deep(.v-field-label), .resource-editor-options :deep(.v-field-label) { font-size: 12px; }
@container (max-width: 860px) {
  .editor-actions { flex-direction: row; }
  .probe-target-cell { grid-column: 1 / -1; }
}
</style>