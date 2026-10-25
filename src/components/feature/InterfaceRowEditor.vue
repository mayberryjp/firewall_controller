<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import FieldInput from "@/components/base/FieldInput.vue";
import { record, type Field } from "@/types/forms";

const props = defineProps<{
  form: Record<string, unknown>;
  fields: Field[];
  columns: number;
  errors: Record<string, string[]>;
  error: string;
  disabled: boolean;
  renaming: boolean;
  renameImpacts: string[];
  acknowledged: boolean;
  loopbacks?: boolean;
}>();
const emit = defineEmits<{
  change: [key: string, value: unknown];
  cancel: [];
  stage: [];
  "update:acknowledged": [value: boolean];
}>();
const row = ref<HTMLTableRowElement | null>(null);
onMounted(() => {
  row.value?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  row.value?.querySelector("input")?.focus();
});
const inputs = computed(() => {
  if (props.loopbacks) return [
    props.fields.find(field => field.key === "name"),
    props.fields.find(field => field.key === "role"),
    { key: "up", label: "Admin state", kind: "switch" as const },
    props.fields.find(field => field.key === "mtu"),
    { key: "addresses", label: "IPv4 addresses / prefixes", kind: "text" as const },
  ].filter((field): field is Field => field !== undefined)
    .map(field => field.key === "role" ? { ...field, label: "Role" } : field);
  const vlan = props.fields.find(field => field.key === "vlan")?.fields ?? [];
  return [
    props.fields.find(field => field.key === "name"),
    vlan.find(field => field.key === "id"),
    { key: "up", label: "Admin state", kind: "switch" as const },
    props.fields.find(field => field.key === "mtu"),
    vlan.find(field => field.key === "parent"),
    { key: "addresses", label: "IPv4 addresses / prefixes", kind: "text" as const },
  ].filter((field): field is Field => field !== undefined);
});
const addresses = computed(() => Array.isArray(props.form.addresses) ? props.form.addresses.map(String) : []);
const ipv4Error = ref("");
function nested(field: Field): boolean { return field.key === "id" || field.key === "parent"; }
function change(field: Field, value: unknown): void {
  if (props.disabled || field.disabled) return;
  if (field.key === "addresses") {
    const edited = String(value ?? "").split(",").map(address => address.trim()).filter(Boolean);
    ipv4Error.value = edited.some(address => address.includes(":")) ? "Enter IPv4 addresses with prefixes; existing IPv6 settings are preserved separately." : "";
    if (!ipv4Error.value) emit("change", "addresses", [...edited, ...addresses.value.filter(address => address.includes(":"))]);
    return;
  }
  emit("change", nested(field) ? "vlan" : field.key,
    nested(field) ? { ...record(props.form.vlan), [field.key]: value } : value);
}
</script>

<template>
  <tr
    ref="row"
    class="interface-editor-row"
    :aria-label="loopbacks ? 'Loopback editor' : 'VLAN editor'"
    @keydown.esc.prevent="emit('cancel')"
  >
    <td
      v-for="field in inputs"
      :key="field.key"
      :class="{ 'numeric-cell': field.kind === 'number', 'role-cell': field.key === 'role' }"
    >
      <span
        class="compact-cell-label"
        aria-hidden="true"
      >{{ field.label }}</span>
      <template v-if="loopbacks && field.key === 'mtu'">
        {{ form.mtu }}
      </template>
      <v-switch
        v-else-if="field.key === 'up'"
        :id="`editor.${field.key}`"
        :model-value="form.up === true"
        aria-label="Admin state"
        :disabled="disabled"
        :error-messages="errors['editor.up']"
        density="compact"
        color="primary"
        hide-details="auto"
        @update:model-value="change(field, Boolean($event))"
      />
      <FieldInput
        v-else
        :field="{ ...field, disabled: disabled || field.disabled }"
        :model-value="field.key === 'addresses' ? addresses.filter(address => !address.includes(':')).join(', ') : nested(field) ? record(form.vlan)[field.key] : form[field.key]"
        :path="`editor.${nested(field) ? 'vlan.' : ''}${field.key}`"
        :errors="errors"
        density="compact"
        variant="outlined"
        @update:model-value="change(field, $event)"
      />
    </td>
    <td :colspan="columns - inputs.length">
      <div class="editor-actions">
        <v-btn
          color="primary"
          size="small"
          :disabled="disabled"
          @click="!ipv4Error && emit('stage')"
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
  <tr v-if="renaming || error || ipv4Error">
    <td :colspan="columns">
      <div
        v-if="renaming"
        class="py-2"
      >
        <p>Rename is a deletion and creation. References are not automatically rewritten.</p>
        <ul v-if="renameImpacts.length">
          <li
            v-for="impact in renameImpacts"
            :key="impact"
          >
            {{ impact }}
          </li>
        </ul>
        <v-checkbox
          :model-value="acknowledged"
          label="I reviewed rename dependencies and will explicitly stage all reference changes."
          :disabled="disabled"
          hide-details
          @update:model-value="emit('update:acknowledged', Boolean($event))"
        />
      </div>
      <p
        v-if="error || ipv4Error"
        role="alert"
        class="text-error py-2"
      >
        {{ ipv4Error || Object.values(errors).flat().join('; ') || error }}
      </p>
    </td>
  </tr>
</template>

<style scoped>
.interface-editor-row > td { padding-top: 8px; padding-bottom: 8px; }
.compact-cell-label { display: none; }
.editor-actions { display: flex; flex-direction: column; gap: 4px; }
.interface-editor-row :deep(.v-input) { width: 100%; min-width: 0; }
.interface-editor-row :deep(.v-field__input) { min-width: 0; padding-inline: 8px; font-size: 13px; }
.interface-editor-row :deep(.v-field-label) { font-size: 12px; }
@container (max-width: 860px) {
  .editor-actions { flex-direction: row; }
}
</style>
