<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import type { Field } from "@/types/forms";
import type { Section } from "@/services/resourceForms";
import FieldInput from "@/components/base/FieldInput.vue";

const props = defineProps<{
  open: boolean;
  section: Section;
  title: string;
  editingIndex: number;
  form: Record<string, unknown>;
  fields: Field[];
  errors: Record<string, string[]>;
  error: string;
  renaming: boolean;
  renameImpacts: string[];
  relaySelection: string;
  disabled: boolean;
}>();
const acknowledged = defineModel<boolean>("acknowledged", { required: true });
defineEmits<{ change: [key: string, value: unknown]; cancel: []; stage: [] }>();
const summary = ref<HTMLElement | null>(null);
watch(() => props.error, async value => {
  if (value) { await nextTick(); summary.value?.focus(); }
});
</script>

<template>
  <v-dialog
    :model-value="open"
    max-width="900"
    persistent
    scrollable
  >
    <v-card :title="`${editingIndex < 0 ? 'Add' : 'Edit'} ${title} — local draft only`">
      <v-card-text id="editor">
        <v-alert
          v-if="section === 'interfaces' && form.kind === 'ethernet'"
          type="warning"
          class="mb-4"
        >
          Changing a management NIC can disconnect this session. Keep console access and verify connectivity before confirming.
          DHCP mode requires removal of static IPv4 addresses; static IPv6 may remain. Releasing management does not delete
          hardware, restart OS DHCP or remove persistent networkd exclusions. Host forwarding remains an operator prerequisite.
        </v-alert>
        <v-alert
          v-if="renaming"
          type="warning"
          variant="tonal"
          class="mb-4"
        >
          Rename is a deletion and creation, not an API rename. References are not automatically rewritten.
          <ul>
            <li
              v-for="impact in renameImpacts"
              :key="impact"
            >
              {{ impact }}
            </li>
          </ul>
          <v-checkbox
            v-model="acknowledged"
            label="I reviewed rename dependencies and will explicitly stage all reference changes."
          />
        </v-alert>
        <p
          v-if="editingIndex < 0"
          class="text-caption mb-4"
        >
          Initial numeric values are frontend presets, not server defaults. Review every field.
        </p>
        <div
          v-if="error"
          ref="summary"
          tabindex="-1"
          role="alert"
          class="mb-4"
        >
          <v-alert type="error">
            {{ error }}
          </v-alert>
          <ul>
            <li
              v-for="(messages, path) in errors"
              :key="path"
            >
              <a :href="`#${path}`">{{ path }}: {{ messages.join("; ") }}</a>
            </li>
          </ul>
        </div>
        <FieldInput
          v-for="field in fields"
          :key="field.key"
          :field="field"
          :model-value="form[field.key]"
          :path="`editor.${field.key}`"
          :errors="errors"
          @update:model-value="$emit('change', field.key, $event)"
        />
        <v-alert
          v-if="section === 'interfaces'"
          type="info"
          variant="tonal"
          class="mt-4"
        >
          Selected DHCP relay address/subnet: {{ relaySelection }} (first eligible IPv4 prefix in canonical lexicographic order).
          All upstreams receive each request; WAN/LAN does not choose upstream links.
          Requires transactions.write and interfaces.write; the server enforces permissions.
          Changing enabled links, servers or selected addresses can restart the shared relay process and briefly disrupt other interfaces.
          Relay provides no DHCP server, DHCPv6, automatic firewall/NAT/routes or daemon installation.
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-btn @click="$emit('cancel')">
          Cancel
        </v-btn>
        <v-btn
          color="primary"
          :disabled="disabled"
          @click="$emit('stage')"
        >
          Stage changes
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>