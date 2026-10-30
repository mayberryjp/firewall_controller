<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { ZodError } from "zod";
import { useControllerStore } from "@/stores/controller";
import { configSchema } from "@/types/domain";
import { cloneConfig, validateConfig } from "@/services/configuration";
import { decodeJson, utf8Size } from "@/services/json";
import { isInitialLoad } from "@/services/datasets";

const store = useControllerStore();
const selected = computed(() => store.draft ?? store.state.data?.desired);
const source = computed(() => selected.value ? JSON.stringify(cloneConfig(selected.value), null, 2) : "");
const text = ref(""), initial = ref(""), revision = ref<string>();
const errors = ref<string[]>([]), saved = ref(false);
const dirty = computed(() => text.value !== initial.value);
const changed = computed(() => source.value !== initial.value || store.state.data?.revision !== revision.value);
const blocked = computed(() => Boolean(store.readOnlyReason) || !selected.value || changed.value);
const loading = computed(() => isInitialLoad(store.state));

function reset(): void {
  text.value = source.value; initial.value = source.value;
  revision.value = store.state.data?.revision;
  errors.value = []; saved.value = false; store.editorDirty = false;
}
watch([source, () => store.state.data?.revision], () => { if (!dirty.value) reset(); }, { immediate: true, flush: "sync" });
watch(() => store.sessionVersion, reset);
watch(dirty, value => { store.editorDirty = value; }, { flush: "sync" });
watch(text, () => { errors.value = []; saved.value = false; }, { flush: "sync" });
onUnmounted(() => { store.editorDirty = false; });

function save(): void {
  errors.value = []; saved.value = false;
  try {
    if (changed.value) throw new Error("Configuration changed while you were editing. Copy your edits, then reset the editor and merge them into the latest configuration.");
    if (store.readOnlyReason) throw new Error(store.readOnlyReason);
    if (!selected.value) throw new Error("Configuration is unavailable.");
    if (utf8Size(text.value) > 1_048_576) throw new Error("Configuration exceeds 1 MiB.");
    const candidate = configSchema.parse(decodeJson(text.value));
    if (candidate.software !== undefined) throw new Error("software is read-only release metadata. Remove it before saving.");
    const issues = validateConfig(candidate, store.runtime.data?.parent_interfaces, store.baseline ?? store.state.data?.desired);
    if (issues.length) {
      errors.value = issues.map(issue => `${issue.path}: ${issue.message}`);
      return;
    }
    store.stage(candidate);
    reset(); saved.value = true;
  } catch (failure) {
    errors.value = failure instanceof ZodError
      ? failure.issues.map(issue => `${issue.path.join(".") || "Configuration"}: ${issue.message}`)
      : [failure instanceof Error ? failure.message : "Unable to save configuration."];
  }
}
</script>

<template>
  <section aria-label="Config editor">
    <h1 class="text-h6 mb-4">
      Config editor
    </h1>
    <p
      id="config-editor-description"
      class="mb-4"
    >
      Edit the desired configuration as JSON, including any staged changes.
      Save stages your edits; review and push them in
      <router-link :to="{ name: 'changes' }">
        SAVE
      </router-link>.
      Read-only software release metadata is excluded.
    </p>
    <p
      v-if="loading"
      role="status"
      class="mb-4"
    >
      Loading configuration...
    </p>
    <v-alert
      v-if="store.state.error"
      type="error"
      role="alert"
      class="mb-4"
    >
      Unable to load configuration: {{ store.state.error }}
    </v-alert>
    <v-alert
      v-if="store.readOnlyNotice"
      type="warning"
      variant="tonal"
      class="mb-4"
    >
      {{ store.readOnlyNotice }}
    </v-alert>
    <v-alert
      v-if="dirty && changed"
      type="warning"
      role="status"
      class="mb-4"
    >
      Configuration changed while you were editing. Copy your edits, then reset the editor
      and merge them into the latest configuration.
    </v-alert>
    <form @submit.prevent="save">
      <label
        for="raw-configuration"
        class="d-block mb-2"
      >Raw configuration (JSON)</label>
      <textarea
        id="raw-configuration"
        v-model="text"
        class="config-editor"
        aria-describedby="config-editor-description"
        :aria-invalid="errors.length > 0"
        :readonly="Boolean(store.readOnlyReason) || !selected"
        spellcheck="false"
        autocapitalize="off"
        autocomplete="off"
        rows="24"
      />
      <div
        v-if="errors.length"
        role="alert"
        class="my-4"
      >
        <p>Configuration was not saved:</p>
        <ul class="pl-6">
          <li
            v-for="(error, index) in errors"
            :key="index"
          >
            {{ error }}
          </li>
        </ul>
      </div>
      <div class="d-flex flex-wrap ga-2 mt-4">
        <v-btn
          type="submit"
          color="primary"
          :disabled="blocked || !dirty"
        >
          Save
        </v-btn>
        <v-btn
          :disabled="!selected || (!dirty && !changed)"
          @click="reset"
        >
          Reset editor
        </v-btn>
      </div>
      <p
        v-if="saved"
        role="status"
        class="mt-4"
      >
        Configuration staged.
        <router-link :to="{ name: 'changes' }">
          Review and push in SAVE
        </router-link>.
      </p>
    </form>
  </section>
</template>

<style scoped>
.config-editor {
  display: block;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 320px;
  padding: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.4);
  border-radius: 4px;
  font-family: monospace;
  font-size: 13px;
  line-height: 1.5;
  tab-size: 2;
  resize: vertical;
  white-space: pre;
  overflow: auto;
}
</style>
