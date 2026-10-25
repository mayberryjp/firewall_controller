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
          Save
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>