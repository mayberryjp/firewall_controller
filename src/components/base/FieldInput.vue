<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { record, type Field } from "@/types/forms";
const props = defineProps<{ field: Field; modelValue: unknown; path: string; errors?: Record<string, string[]> }>();
const emit = defineEmits<{ "update:modelValue": [value: unknown] }>();
const rows = computed<unknown[]>(() => Array.isArray(props.modelValue) ? props.modelValue : []);
const rowIDs = ref<string[]>([]);
watch(() => rows.value.length, (length) => {
  while (rowIDs.value.length < length) rowIDs.value.push(crypto.randomUUID());
  rowIDs.value.length = length;
}, { immediate: true });
const text = computed(() => typeof props.modelValue === "string" || typeof props.modelValue === "number" ? props.modelValue : "");
const lines = computed(() => rows.value.join("\n"));
function updateLines(value: string): void {
  emit("update:modelValue", value.split("\n").map(item => item.trim()).filter(Boolean));
}
function property(key: string, value: unknown): void { emit("update:modelValue", { ...record(props.modelValue), [key]: value }); }
function item(index: number, key: string, value: unknown): void {
  emit("update:modelValue", rows.value.map((row, i) => i === index ? { ...record(row), [key]: value } : row));
}
function remove(index: number): void {
  rowIDs.value.splice(index, 1);
  emit("update:modelValue", rows.value.filter((_, i) => i !== index));
}
function move(index: number, delta: number): void {
  const values = [...rows.value], target = index + delta, ids = [...rowIDs.value];
  [values[index], values[target]] = [values[target], values[index]];
  const current = ids[index], other = ids[target];
  if (current && other) { ids[index] = other; ids[target] = current; }
  rowIDs.value = ids; emit("update:modelValue", values);
}
</script>
<template>
  <v-text-field
    v-if="field.kind === 'text' || field.kind === 'number'"
    :id="path"
    :model-value="text"
    :label="field.label"
    :type="field.kind === 'number' ? 'number' : 'text'"
    :disabled="field.disabled"
    :hint="field.hint"
    :persistent-hint="Boolean(field.hint)"
    :error-messages="errors?.[path]"
    @update:model-value="emit('update:modelValue', field.kind === 'number' && $event !== '' && $event !== null ? Number($event) : ($event ?? ''))"
  />
  <v-checkbox
    v-else-if="field.kind === 'switch'"
    :id="path"
    :model-value="modelValue === true"
    :label="field.label"
    :disabled="field.disabled"
    :hint="field.hint"
    :persistent-hint="Boolean(field.hint)"
    :error-messages="errors?.[path]"
    @update:model-value="emit('update:modelValue', Boolean($event))"
  />
  <v-select
    v-else-if="field.kind === 'select'"
    :id="path"
    :model-value="text"
    :label="field.label"
    :items="field.choices"
    :disabled="field.disabled"
    :hint="field.hint"
    :persistent-hint="Boolean(field.hint)"
    :error-messages="errors?.[path]"
    @update:model-value="emit('update:modelValue', $event)"
  />
  <v-textarea
    v-else-if="field.kind === 'lines'"
    :id="path"
    :model-value="lines"
    :label="field.label"
    rows="3"
    auto-grow
    :hint="field.hint || 'One value per line. Values are validated, never silently canonicalized.'"
    persistent-hint
    :error-messages="errors?.[path]"
    @update:model-value="updateLines(String($event))"
  />
  <fieldset
    v-else-if="field.kind === 'object'"
    :id="path"
    class="field-group"
  >
    <legend>{{ field.label }}</legend>
    <FieldInput
      v-for="child in field.fields"
      :key="child.key"
      :field="child"
      :path="`${path}.${child.key}`"
      :errors="errors"
      :model-value="record(modelValue)[child.key]"
      @update:model-value="property(child.key, $event)"
    />
  </fieldset>
  <fieldset
    v-else-if="field.kind === 'rows'"
    :id="path"
    class="field-group"
  >
    <legend>{{ field.label }}</legend>
    <v-card
      v-for="(row, index) in rows"
      :key="rowIDs[index]"
      border
      class="pa-4 mb-4"
    >
      <p class="text-subtitle-2 mb-3">
        {{ field.label }} · {{ index + 1 }}
      </p>
      <FieldInput
        v-for="child in field.fields"
        :key="child.key"
        :field="child"
        :path="`${path}.${index}.${child.key}`"
        :errors="errors"
        :model-value="record(row)[child.key]"
        @update:model-value="item(index, child.key, $event)"
      />
      <div class="d-flex flex-wrap ga-2">
        <v-btn
          size="small"
          :aria-label="`Move ${field.label} ${index + 1} up`"
          :disabled="index === 0"
          @click="move(index, -1)"
        >
          Move up
        </v-btn>
        <v-btn
          size="small"
          :aria-label="`Move ${field.label} ${index + 1} down`"
          :disabled="index === rows.length - 1"
          @click="move(index, 1)"
        >
          Move down
        </v-btn>
        <v-btn
          size="small"
          color="error"
          :aria-label="`Remove ${field.label} ${index + 1}`"
          @click="remove(index)"
        >
          Remove
        </v-btn>
      </div>
    </v-card>
    <p
      v-if="!rows.length"
      class="mb-3"
    >
      No {{ field.label.toLowerCase() }}.
    </p>
    <v-btn
      size="small"
      @click="emit('update:modelValue', [...rows, field.create?.()])"
    >
      Add {{ field.label.toLowerCase() }}
    </v-btn>
  </fieldset>
</template>
