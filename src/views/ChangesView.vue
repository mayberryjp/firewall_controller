<script setup lang="ts">
import { nextTick, ref } from "vue";
import { useControllerStore } from "@/stores/controller";
import type { Config } from "@/types/domain";
import { importConfig, validateConfig } from "@/services/configuration";
import { useConfigExport } from "@/composables/useConfigExport";
import ConfigDiff from "@/components/feature/ConfigDiff.vue";
import ApplyConfigurationDialog from "@/components/feature/ApplyConfigurationDialog.vue";
const store = useControllerStore();
const { exportConfig, exportError } = useConfigExport();
const error = ref(""), summary = ref<HTMLElement | null>(null);
const applyDialog = ref(false);
const destructive = ref<"discard" | "restart" | null>(null), importText = ref(""), imported = ref<Config | null>(null);
const importDialog = ref(false), importAcknowledged = ref(false);
async function showError(failure: unknown): Promise<void> {
  error.value = failure instanceof Error ? failure.message : "Operation failed";
  await nextTick(); summary.value?.focus();
}
function discard(): void {
  try { if (destructive.value === "restart") store.restartDraft(); else store.discardDraft(); destructive.value = null; }
  catch (failure) { void showError(failure); }
}
function previewImport(): void {
  try {
    if (store.readOnlyReason || !store.state.data) throw new Error(store.readOnlyReason || "Committed state unavailable");
    const candidate = importConfig(importText.value);
    const issues = validateConfig(candidate, store.runtime.data?.parent_interfaces, store.state.data.desired);
    if (issues.length) throw new Error(issues.map(issue => `${issue.path}: ${issue.message}`).join("\n"));
    imported.value = candidate; importAcknowledged.value = false; importDialog.value = true; error.value = "";
  } catch (failure) { void showError(failure); }
}
async function readFile(event: Event): Promise<void> {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  const file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > 1_048_576) throw new Error("Import file exceeds 1 MiB");
    importText.value = await file.text(); previewImport();
  } catch (failure) { await showError(failure); }
  finally { input.value = ""; }
}
function acceptImport(): void {
  if (!imported.value || !importAcknowledged.value) return;
  try { store.stage(imported.value); importDialog.value = false; imported.value = null; importText.value = ""; }
  catch (failure) { void showError(failure); }
}
</script>
<template>
  <section aria-label="Review changes">
    <div
      v-if="error || exportError"
      ref="summary"
      tabindex="-1"
      role="alert"
      class="mb-4"
    >
      <v-alert
        type="error"
        class="wrap-text"
      >
        {{ error || exportError }}
      </v-alert>
    </div>
    <p
      v-if="store.draft"
      class="text-caption text-medium-emphasis mb-3"
    >
      Base revision {{ store.baseRevision }}
    </p>
    <div class="d-flex flex-wrap ga-3 mb-5">
      <v-btn
        v-if="store.draft"
        @click="exportConfig(store.draft, 'netcontrol-draft')"
      >
        Export draft config
      </v-btn>
      <v-btn
        v-if="store.draft"
        color="error"
        variant="outlined"
        :disabled="Boolean(store.submitted || store.uncertain || store.busy)"
        @click="destructive = 'discard'"
      >
        Discard draft
      </v-btn>
      <v-btn
        v-if="store.draft"
        :disabled="Boolean(store.submitted || store.uncertain || store.busy)"
        @click="destructive = 'restart'"
      >
        Restart from latest desired
      </v-btn>
    </div>
    <template v-if="store.draft && store.baseline">
      <v-alert
        v-if="store.draftStale"
        type="warning"
        class="mb-4"
      >
        Stale draft: comparison against latest desired is below. Export before explicitly discarding/restarting. No automatic rebase.
      </v-alert>
      <ConfigDiff
        :before="store.baseline"
        :after="store.draft"
      />
      <template v-if="store.draftStale && store.state.data">
        <h2 class="text-h5 mb-3">
          Latest desired versus retained draft
        </h2><ConfigDiff
          :before="store.state.data.desired"
          :after="store.draft"
        />
      </template>
      <div
        v-if="store.validation.length"
        tabindex="-1"
        aria-label="Validation summary"
        class="my-5"
      >
        <h2 class="text-h6">
          {{ store.validation.length }} validation issues
        </h2>
        <ul>
          <li
            v-for="issue in store.validation"
            :key="`${issue.path}/${issue.message}`"
          >
            <router-link :to="issue.page">
              {{ issue.path }}
            </router-link>: {{ issue.message }}
          </li>
        </ul>
      </div>
      <v-btn
        color="primary"
        :disabled="!store.canApply || !store.freshState"
        @click="applyDialog = true"
      >
        Review provisional apply
      </v-btn>
      <p
        v-if="!store.canApply"
        class="mt-3 text-warning"
      >
        {{ store.readOnlyReason || (store.validation.length ? "Resolve validation errors before applying." : !store.diff.length ? "No changes to apply." : "Refresh state and resolve the active warnings before applying.") }}
      </p>
    </template>
    <p
      v-if="!store.draft"
      class="text-medium-emphasis mb-4"
    >
      No unsaved changes.
    </p>
    <details class="mt-6">
      <summary>Import configuration</summary>
      <label
        for="config-file"
        class="d-block mt-3"
      >Configuration file</label>
      <input
        id="config-file"
        type="file"
        accept=".json,application/json"
        class="d-block my-3"
        :disabled="Boolean(store.readOnlyReason)"
        @change="readFile"
      >
      <v-textarea
        v-model="importText"
        label="Configuration JSON"
        rows="5"
        class="mono"
      />
      <v-btn
        :disabled="!importText || Boolean(store.readOnlyReason)"
        @click="previewImport"
      >
        Preview import / deletions
      </v-btn>
    </details>
    <v-dialog
      v-model="importDialog"
      max-width="900"
      scrollable
    >
      <v-card title="Replace local draft — no server write">
        <v-card-text>
          <ConfigDiff
            v-if="imported && (store.draft || store.state.data)"
            :before="(store.draft || store.state.data!.desired)"
            :after="imported"
          />
          <v-checkbox
            v-model="importAcknowledged"
            label="I reviewed the full replacement and deletion impact."
          />
        </v-card-text>
        <v-card-actions>
          <v-btn @click="importDialog = false">
            Cancel
          </v-btn><v-btn
            color="primary"
            :disabled="!importAcknowledged"
            @click="acceptImport"
          >
            Replace local draft
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <v-dialog
      :model-value="destructive !== null"
      max-width="580"
      @update:model-value="!$event && (destructive = null)"
    >
      <v-card :title="destructive === 'restart' ? 'Discard and restart from latest desired?' : 'Discard shared draft?'">
        <v-card-text>Local work across all resource pages will be lost. Export first if it should be retained. No server mutation occurs.</v-card-text>
        <v-card-actions>
          <v-btn @click="destructive = null">
            Cancel
          </v-btn><v-btn
            color="error"
            @click="discard"
          >
            {{ destructive === "restart" ? "Discard and restart" : "Discard shared draft" }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <ApplyConfigurationDialog
      v-model="applyDialog"
      edit-options
    />
  </section>
</template>
