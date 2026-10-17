<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { useRouter } from "vue-router";
import { useControllerStore } from "@/stores/controller";
import type { Config } from "@/types/domain";
import { cloneConfig, importConfig, requiredPermissions, validateConfig } from "@/services/configuration";
import { useConfigExport } from "@/composables/useConfigExport";
import ConfigDiff from "@/components/feature/ConfigDiff.vue";
import JsonPanel from "@/components/base/JsonPanel.vue";
const store = useControllerStore(), router = useRouter();
const { exportConfig, exportError } = useConfigExport();
const seconds = ref<number | string>(120), description = ref(""), error = ref(""), summary = ref<HTMLElement | null>(null);
const acknowledged = ref(false), dropAcknowledged = ref(false), applyDialog = ref(false);
const destructive = ref<"discard" | "restart" | null>(null), importText = ref(""), imported = ref<Config | null>(null);
const importDialog = ref(false), importAcknowledged = ref(false);
const permissions = computed(() => requiredPermissions(store.diff));
const dropRisk = computed(() => store.draft?.firewall.policy === "drop" || store.draft?.firewall.rules.some(rule => rule.action === "drop" && !rule.source && !rule.destination));
async function showError(failure: unknown): Promise<void> {
  error.value = failure instanceof Error ? failure.message : "Operation failed";
  await nextTick(); summary.value?.focus();
}
function start(): void {
  try { if (store.state.data) store.stage(cloneConfig(store.state.data.desired)); }
  catch (failure) { void showError(failure); }
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
async function apply(): Promise<void> {
  if (!acknowledged.value || (dropRisk.value && !dropAcknowledged.value)) return;
  try {
    error.value = "";
    const transaction = await store.apply(Number(seconds.value), description.value);
    applyDialog.value = false;
    if (transaction) await router.push(`/transactions/${encodeURIComponent(transaction.id)}`);
  } catch (failure) { await showError(failure); applyDialog.value = false; }
}
</script>
<template>
  <section>
    <h1 class="text-h4 mb-4">
      Changes / complete-package review
    </h1>
    <p class="mb-4">
      Committed, observed, draft, and provisional candidate are distinct. All resource editors share this draft; staging never writes to the API.
    </p>
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
    <p class="mb-4">
      Captured base: <span class="mono">{{ store.baseRevision ?? "No draft" }}</span> · latest committed: <span class="mono">{{ store.state.data?.revision ?? "Unknown" }}</span>
    </p>
    <div class="d-flex flex-wrap ga-3 mb-5">
      <v-btn
        v-if="!store.draft"
        color="primary"
        :disabled="Boolean(store.readOnlyReason)"
        @click="start"
      >
        Start draft from committed desired
      </v-btn>
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
      <h2 class="text-h5 mb-3">
        Captured baseline versus draft
      </h2>
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
        tabindex="-1"
        aria-label="Validation summary"
        class="my-5"
      >
        <h2 class="text-h6">
          Validation: {{ store.validation.length ? `${store.validation.length} issues` : "locally valid; server preflight still required" }}
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
      <p class="mb-5">
        Required permissions (no discovery endpoint): <span class="mono">{{ permissions.join(", ") }}</span>. A 403 preserves the draft; another authorized operator may be needed for recovery.
      </p>
      <v-text-field
        v-model="description"
        label="Optional description (trimmed; maximum 1024 UTF-8 bytes)"
      />
      <v-text-field
        v-model="seconds"
        type="number"
        label="Confirmation window seconds (10..300; frontend default 120)"
        min="10"
        max="300"
      />
      <v-btn
        color="primary"
        :disabled="!store.canApply || !store.freshState"
        @click="applyDialog = true; acknowledged = false; dropAcknowledged = false"
      >
        Review provisional apply
      </v-btn>
      <p
        v-if="!store.canApply"
        class="mt-3 text-warning"
      >
        Apply blocked: resolve validation, empty changes, stale/unavailable discovery, stale base, drift, active transaction, or frozen/uncertain write.
      </p>
      <JsonPanel
        :value="store.draft"
        label="Exact draft config (read-only)"
      />
      <JsonPanel
        v-if="store.submitted"
        :value="store.submitted.config"
        label="Frozen submitted snapshot"
      />
    </template>
    <h2 class="text-h5 mt-8 mb-4">
      Import complete Config JSON
    </h2>
    <p class="mb-4">
      Replaces the local draft only after preview. All top-level sections are required. No merge, request-wrapper metadata, unknown fields, or trailing JSON values.
    </p>
    <label for="config-file">Choose sensitive configuration JSON</label>
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
      label="Or paste complete Config JSON"
      rows="5"
      class="mono"
    />
    <v-btn
      :disabled="!importText || Boolean(store.readOnlyReason)"
      @click="previewImport"
    >
      Preview import / deletions
    </v-btn>
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
    <v-dialog
      v-model="applyDialog"
      max-width="700"
      persistent
    >
      <v-card title="Apply complete configuration provisionally">
        <v-card-text>
          <p>
            This replaces all owned configuration, including deletions. Networking can be disrupted and intermediate states are visible; it is not an atomic kernel transaction.
            The confirmation clock starts before the response. Confirm explicitly before the server deadline. Out-of-band access and operator-managed forwarding may be necessary.
          </p>
          <v-checkbox
            v-model="acknowledged"
            label="I reviewed the complete package, deletion impact, disruption risk, deadline, and recovery prerequisites."
          />
          <v-checkbox
            v-if="dropRisk"
            v-model="dropAcknowledged"
            label="I explicitly acknowledge default drop / catch-all drop and potentially unreachable later rules."
          />
        </v-card-text>
        <v-card-actions class="flex-wrap">
          <v-btn
            :disabled="store.busy"
            @click="applyDialog = false"
          >
            Cancel
          </v-btn>
          <v-btn
            color="warning"
            :loading="store.busy"
            :disabled="!acknowledged || (dropRisk && !dropAcknowledged) || !store.canApply"
            @click="apply"
          >
            Apply provisionally
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>
