<script setup lang="ts">
import { nextTick, ref } from "vue";
import { useControllerStore } from "@/stores/controller";
import ConfigDiff from "@/components/feature/ConfigDiff.vue";
import ApplyConfigurationDialog from "@/components/feature/ApplyConfigurationDialog.vue";
const store = useControllerStore();
const error = ref(""), summary = ref<HTMLElement | null>(null);
const applyDialog = ref(false);
const checking = ref(false);
const comparison = ref<"base" | "latest">("base");
const destructive = ref<"discard" | "restart" | null>(null);
async function showError(failure: unknown): Promise<void> {
  error.value = failure instanceof Error ? failure.message : "Operation failed";
  await nextTick(); summary.value?.focus();
}
async function reviewPush(): Promise<void> {
  if (checking.value || store.busy) return;
  checking.value = true;
  try {
    error.value = "";
    await store.refresh();
    if (store.canApply && !store.editorDirty) applyDialog.value = true;
  }
  catch (failure) { await showError(failure); }
  finally { checking.value = false; }
}
function discard(): void {
  try { if (destructive.value === "restart") store.restartDraft(); else store.discardDraft(); destructive.value = null; }
  catch (failure) { void showError(failure); }
}
</script>
<template>
  <section aria-label="SAVE">
    <div
      v-if="error"
      ref="summary"
      tabindex="-1"
      role="alert"
      class="mb-4"
    >
      <v-alert
        type="error"
        class="wrap-text"
      >
        {{ error }}
      </v-alert>
    </div>
    <div class="d-flex flex-wrap align-center ga-2 mb-4">
      <span
        v-if="store.draft"
        class="text-body-2 text-medium-emphasis mr-auto"
      >Base revision {{ store.baseRevision }}</span>
      <v-btn
        v-if="store.draft"
        color="error"
        icon="mdi-delete-outline"
        variant="text"
        aria-label="Discard draft"
        title="Discard draft"
        :disabled="Boolean(store.submitted || store.uncertain || store.busy || checking)"
        @click="destructive = 'discard'"
      />
      <v-btn
        v-if="store.draft && store.draftStale"
        :disabled="Boolean(store.submitted || store.uncertain || store.busy || checking)"
        @click="destructive = 'restart'"
      >
        Discard and start over
      </v-btn>
      <v-btn
        v-if="store.draft && store.baseline"
        color="primary"
        prepend-icon="mdi-source-commit"
        :loading="checking"
        :disabled="Boolean(store.readOnlyReason) || checking || store.editorDirty || !store.diff.length || Boolean(store.validation.length)"
        @click="reviewPush"
      >
        Commit &amp; push
      </v-btn>
    </div>
    <template v-if="store.draft && store.baseline">
      <v-alert
        v-if="store.draftStale"
        type="warning"
        class="mb-4"
      >
        Stale draft: base revision {{ store.baseRevision }}, current revision {{ store.state.data?.revision }}. Apply is blocked; no automatic rebase.
      </v-alert>
      <v-btn-toggle
        v-if="store.draftStale && store.state.data"
        v-model="comparison"
        mandatory
        density="compact"
        aria-label="Comparison baseline"
        class="mb-4"
      >
        <v-btn value="base">
          Base r{{ store.baseRevision }}
        </v-btn>
        <v-btn value="latest">
          Latest r{{ store.state.data.revision }}
        </v-btn>
      </v-btn-toggle>
      <ConfigDiff
        :before="comparison === 'latest' && store.draftStale && store.state.data ? store.state.data.desired : store.baseline"
        :after="store.draft"
      />
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
      <p
        v-if="!store.canApply"
        class="mt-3 text-warning"
        role="status"
      >
        {{ store.applyBlockedReason }}
      </p>
    </template>
    <p
      v-if="!store.draft"
      class="text-medium-emphasis mb-4"
    >
      No unsaved changes.
    </p>
    <v-dialog
      :model-value="destructive !== null"
      max-width="580"
      @update:model-value="!$event && (destructive = null)"
    >
      <v-card :title="destructive === 'restart' ? 'Discard changes and start from the current revision?' : 'Discard changes?'">
        <v-card-text>Unpushed changes across all pages will be lost. The firewall will not be changed.</v-card-text>
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
