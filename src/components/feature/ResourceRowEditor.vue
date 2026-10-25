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
  position?: number;
  wide?: boolean;
}>();
const emit = defineEmits<{ change: [key: string, value: unknown]; cancel: []; stage: [] }>();
const row = ref<HTMLTableRowElement | null>(null);
const inputs = computed(() => props.keys.map(key => props.fields.find(field => field.key === key)).filter((field): field is Field => Boolean(field)));
const options = computed(() => props.fields.filter(field => !props.keys.includes(field.key)));
const showAdvanced = ref(false);
// Target-style rows keep the toggle beside the target field; wide rows lay everything out across the full table width.
const spanTarget = computed(() => props.collapseOptions && !props.wide);
const optionsId = useId();
function cancelOnEscape(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.target instanceof Element && event.target.closest('[role="combobox"], [role="option"], [role="listbox"]')) return;
  event.preventDefault();
  emit("cancel");
}
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
    @keydown.esc="cancelOnEscape"
  >
    <td
      v-if="wide"
      :colspan="columns"
    >
      <div class="wide-editor">
        <div
          v-for="field in inputs"
          :key="field.key"
          class="wide-editor-field"
        >
          <FieldInput
            :field="{ ...field, hideLabel: true, placeholder: field.label, disabled: disabled || field.disabled }"
            :model-value="form[field.key]"
            :path="`editor.${field.key}`"
            :errors="errors"
            density="compact"
            variant="outlined"
            @update:model-value="emit('change', field.key, $event)"
          />
        </div>
        <div class="wide-editor-actions">
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
          <v-btn
            v-if="collapseOptions && options.length"
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
      </div>
    </td>
    <td v-if="!wide && position !== undefined">
      <span
        class="compact-cell-label"
        aria-hidden="true"
      >Position</span>
      {{ position }}
    </td>
    <td
      v-for="field in wide ? [] : inputs"
      :key="field.key"
      :class="{ 'probe-target-cell': spanTarget && field.key === 'target' }"
      :colspan="spanTarget && field.key === 'target' ? columns - inputs.length : 1"
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
        :class="{ 'probe-target-controls': spanTarget && field.key === 'target' }"
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
          v-if="spanTarget && field.key === 'target' && options.length"
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
    <td
      v-if="!wide"
      :colspan="spanTarget ? 1 : columns - inputs.length - Number(position !== undefined)"
    >
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
    @keydown.esc="cancelOnEscape"
  >
    <td :colspan="columns">
      <div
        v-show="!collapseOptions || showAdvanced"
        :id="optionsId"
        class="resource-editor-options"
        :class="{ 'single-column': wide }"
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
.editor-actions { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
.wide-editor { display: flex; flex-wrap: nowrap; align-items: flex-start; gap: 12px; padding-block: 4px; }
.wide-editor-field { flex: 1 1 0; min-width: 0; }
.wide-editor-actions { display: flex; align-items: center; gap: 4px; flex: 0 0 auto; padding-top: 4px; white-space: nowrap; }
.probe-target-controls { display: flex; align-items: flex-start; gap: 8px; }
.probe-target-controls > :deep(.v-input) { flex: 1 1 0; }
.probe-target-controls > .v-btn { flex: 0 0 auto; margin-top: 4px; }
.resource-editor-options { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr)); gap: 12px; padding-block: 8px; }
.resource-editor-options > :deep(fieldset) { grid-column: 1 / -1; }
.resource-editor-options.single-column { grid-template-columns: minmax(0, 420px); }
.resource-editor-row :deep(.v-input), .resource-editor-options :deep(.v-input) { min-width: 0; }
.resource-editor-row :deep(.v-field__input), .resource-editor-options :deep(.v-field__input) { min-width: 0; padding-inline: 8px; font-size: 13px; }
.resource-editor-row :deep(.v-field-label), .resource-editor-options :deep(.v-field-label) { font-size: 12px; }
@container (max-width: 860px) {
  .wide-editor { flex-wrap: wrap; }
  .wide-editor-field { flex: 1 1 180px; }
  .editor-actions { flex-direction: row; }
  .probe-target-cell { grid-column: 1 / -1; }
}
</style>