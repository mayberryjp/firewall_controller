<script setup lang="ts">
import { computed } from "vue";
import { useControllerStore } from "@/stores/controller";
import FieldInput from "@/components/base/FieldInput.vue";
import { prefix } from "@/services/configuration";
import type { ResourceRow } from "@/composables/useResourceCollection";
import type { Field } from "@/types/forms";

const props = defineProps<{
  form: Record<string, unknown>;
  columns: number;
  keys: string[];
  row: ResourceRow;
  errors: Record<string, string[]>;
  error: string;
  disabled: boolean;
}>();
const emit = defineEmits<{ change: [key: string, value: unknown]; cancel: []; stage: [] }>();
const store = useControllerStore();
const labels: Record<string, string> = { name: "Name", role: "Role", up: "Admin state", mtu: "MTU", addresses: "IPv4", ipv6_addresses: "IPv6" };
const fields: Record<string, Field> = {
  display_name: { key: "display_name", label: "Display name", kind: "text" },
  addresses: { key: "addresses", label: "IPv4 addresses / prefixes", kind: "text" },
  ipv6_addresses: { key: "ipv6_addresses", label: "IPv6 addresses / prefixes", kind: "text" },
  mtu: { key: "mtu", label: "MTU", kind: "number" },
};
const addresses = computed(() => Array.isArray(props.form.addresses) ? props.form.addresses.map(String) : []);
function ipv6(address: string): boolean {
  try { return prefix(address, false).family === "ipv6"; } catch { return false; }
}
function mode(value: unknown): void {
  if (props.disabled) return;
  if (value !== "static" && value !== "dhcp") return;
  emit("change", "address_mode", value);
  if (value === "dhcp") emit("change", "addresses", addresses.value.filter(ipv6));
}
function change(key: string, value: unknown): void {
  if (props.disabled || (key === "addresses" && props.form.address_mode === "dhcp")) return;
  if (key === "addresses" || key === "ipv6_addresses") {
    const keep = addresses.value.filter(address => ipv6(address) !== (key === "ipv6_addresses"));
    const edited = String(value ?? "").split(",").map(address => address.trim()).filter(Boolean);
    emit("change", "addresses", key === "addresses" ? [...edited, ...keep] : [...keep, ...edited]);
  } else emit("change", key, value);
}
function value(key: string): unknown {
  if (key === "addresses" && props.form.address_mode === "dhcp") {
    const committed = store.state.data?.desired.dhcp_clients?.[String(props.form.name)];
    return (committed ? props.row.discovered?.addresses.filter(address => !address.includes(":")).join(", ") : "") || "DHCP";
  }
  if (key === "addresses" || key === "ipv6_addresses") return addresses.value.filter(address => ipv6(address) === (key === "ipv6_addresses")).join(", ");
  return props.form[key];
}
</script>

<template>
  <tr
    class="physical-editor-row"
    :aria-label="`Configure ${form.name}`"
  >
    <td
      v-for="key in keys"
      :key="key"
      :class="{ 'ipv4-cell': key === 'addresses' }"
    >
      <span
        class="compact-cell-label"
        aria-hidden="true"
      >{{ labels[key] }}</span>
      <template v-if="key === 'name'">
        <FieldInput
          :field="{ ...fields.display_name!, disabled }"
          :model-value="form.display_name"
          path="editor.display_name"
          :errors="errors"
          density="compact"
          variant="outlined"
          @update:model-value="change('display_name', $event)"
        />
        <div class="interface-name text-caption text-medium-emphasis mt-2">
          {{ form.name }}
        </div>
      </template>
      <template v-else-if="key === 'addresses'">
        <div class="ipv4-fields">
          <select
            :value="form.address_mode"
            :disabled="disabled"
            aria-label="IPv4 configuration"
            class="compact-select"
            @change="mode(($event.target as HTMLSelectElement).value)"
          >
            <option value="dhcp">
              DHCP
            </option>
            <option value="static">
              Static
            </option>
          </select>
          <FieldInput
            :field="{ ...fields.addresses!, disabled: disabled || form.address_mode === 'dhcp' }"
            :model-value="value('addresses')"
            path="editor.addresses"
            :errors="errors"
            density="compact"
            variant="outlined"
            @update:model-value="change('addresses', $event)"
          />
        </div>
      </template>
      <FieldInput
        v-else-if="fields[key]"
        :field="{ ...fields[key]!, disabled }"
        :model-value="value(key)"
        :path="`editor.${key}`"
        :errors="key === 'ipv6_addresses' ? { ...errors, 'editor.ipv6_addresses': errors['editor.addresses'] ?? [] } : errors"
        density="compact"
        variant="outlined"
        @update:model-value="change(key, $event)"
      />
      <select
        v-else-if="key === 'role'"
        :value="form.role"
        :disabled="disabled"
        aria-label="Role"
        class="compact-select"
        @change="change('role', ($event.target as HTMLSelectElement).value)"
      >
        <option value="wan">
          WAN
        </option>
        <option value="lan">
          LAN
        </option>
        <option value="unassigned">
          Unassigned
        </option>
      </select>
      <select
        v-else-if="key === 'up'"
        :value="String(form.up)"
        :disabled="disabled"
        aria-label="Admin state"
        class="compact-select"
        @change="change('up', ($event.target as HTMLSelectElement).value === 'true')"
      >
        <option value="true">
          Up
        </option>
        <option value="false">
          Down
        </option>
      </select>
      <span v-else>{{ form[key] }}</span>
    </td>
    <td>
      <form
        :aria-label="`Stage ${form.name}`"
        class="editor-actions"
        @submit.prevent="emit('stage')"
      >
        <v-btn
          type="submit"
          aria-label="Save"
          color="primary"
          size="small"
          :disabled="disabled"
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
      </form>
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
.physical-editor-row > td { padding-top: 8px; padding-bottom: 8px; }
.interface-name { font-family: monospace; }
.compact-cell-label { display: none; }
.editor-actions { display: flex; flex-direction: column; gap: 4px; }
.ipv4-fields { display: grid; grid-template-columns: 76px minmax(0, 1fr); align-items: start; gap: 8px; }
.physical-editor-row :deep(.v-input) { min-width: 0; }
.physical-editor-row :deep(.v-field__input) { min-width: 0; padding-inline: 8px; font-size: 13px; }
.physical-editor-row :deep(.v-field-label) { font-size: 12px; }
.compact-select { width: 100%; min-width: 0; height: 40px; padding: 6px 8px; border: 1px solid rgba(var(--v-theme-on-surface), 0.4); border-radius: 4px; color: inherit; background: rgb(var(--v-theme-surface)); font: inherit; font-size: 13px; appearance: auto; }
.compact-select:disabled { opacity: 0.5; }
@container (max-width: 860px) {
  .editor-actions { flex-direction: row; }
}
</style>
