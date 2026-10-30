<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useControllerStore } from "@/stores/controller";
import { validateConfig } from "@/services/configuration";
import {
  getSandoConnections, getSandoDevices, importSando,
  sandoBaseUrl, replaceSandoRules, type SandoImport,
} from "@/services/sando";
import { sandoSchema, sandoImportReportSchema, type SandoSettings } from "@/services/sandoState";
import { cloneConfig } from "@/services/configuration";
import { useTimestamps } from "@/composables/useTimestamps";

const store = useControllerStore();
const { formatTimestamp, timeZone } = useTimestamps();
const endpoint = ref(""), savedEndpoint = ref("");
const syncToggleVersion = ref(0);
const error = ref(""), notice = ref(""), skipped = ref<string[]>([]), importing = ref<"hosts" | "rules" | null>(null);
const acknowledgeMode = ref(false);
const config = computed(() => store.draft ?? store.state.data?.desired);
const lastImportAt = computed(() => {
  const settings = config.value?.sando;
  const timestamps = [settings?.hosts_import, settings?.rules_import]
    .flatMap(report => report ? [Date.parse(report.last_import_at)] : []);
  return timestamps.length ? Math.max(...timestamps) : null;
});
const newHostPolicy = ref<"accept" | "drop">("drop");
const modeChange = computed(() => Boolean(config.value && !config.value.firewall.policies));
const settingsBlocked = computed(() => store.readOnlyReason ||
  (!store.state.data?.desired.sando ? "This backend does not support saved Sando settings and import reports. Update the appliance backend first." : ""));
const blocked = computed(() => settingsBlocked.value ||
  (config.value?.firewall.rules.length ? "Remove legacy forwarding rules in the shared draft before importing host policies. Existing rules will not be removed automatically." : ""));
const blockedNotice = computed(() => store.connecting && !store.connected ? "" :
  store.readOnlyNotice || (store.state.data ? blocked.value : store.state.error ?? ""));
const disabled = computed(() => Boolean(importing.value || blocked.value || !endpoint.value.trim() || modeChange.value && !acknowledgeMode.value));
let request: AbortController | undefined;
watch(() => config.value?.sando?.api_url ?? "", value => {
  if (endpoint.value === savedEndpoint.value) endpoint.value = value;
  savedEndpoint.value = value;
}, { immediate: true });
watch([endpoint, savedEndpoint], () => { store.editorDirty = endpoint.value !== savedEndpoint.value; });
function stageSettings(update: Partial<Pick<SandoSettings, "api_url" | "sync_enabled">>): void {
  if (settingsBlocked.value || !config.value) throw new Error(settingsBlocked.value || "Configuration unavailable.");
  const candidate = cloneConfig(config.value);
  candidate.sando = sandoSchema.parse({ ...candidate.sando, ...update });
  store.stage(candidate);
}
function setSync(enabled: boolean | null): void {
  error.value = ""; notice.value = ""; skipped.value = [];
  try {
    if (typeof enabled !== "boolean") throw new Error("Choose enabled or disabled for automatic sync.");
    stageSettings({ sync_enabled: enabled });
    notice.value = `Automatic sync ${enabled ? "enabled" : "disabled"} staged. Review in SAVE.`;
  } catch (cause) {
    syncToggleVersion.value++;
    error.value = `Unable to change automatic Sando sync: ${cause instanceof Error ? cause.message : "configuration unavailable"}`;
  }
}
function saveEndpoint(): void {
  error.value = ""; notice.value = ""; skipped.value = [];
  try {
    const normalized = endpoint.value.trim() ? sandoBaseUrl(endpoint.value) : "";
    stageSettings({ api_url: normalized });
    endpoint.value = normalized; savedEndpoint.value = normalized; store.editorDirty = false;
    notice.value = "Endpoint staged. Review in SAVE.";
  } catch (cause) {
    error.value = `Unable to save Sando endpoint: ${cause instanceof Error ? cause.message : "storage unavailable"}`;
  }
}
async function runImport(kind: "hosts" | "rules"): Promise<void> {
  error.value = ""; notice.value = ""; skipped.value = [];
  if (disabled.value || !config.value) {
    error.value = blocked.value || "Enter a Sando endpoint and acknowledge the policy mode change before importing.";
    return;
  }
  const controller = new AbortController();
  request = controller; importing.value = kind;
  const session = store.sessionVersion;
  const savedSource = config.value.sando?.api_url;
  try {
    const base = sandoBaseUrl(endpoint.value);
    const policy = newHostPolicy.value;
    const inventory = await getSandoDevices(base, controller.signal);
    const connections = kind === "rules" ? await getSandoConnections(base, controller.signal, inventory.flatMap(device =>
      device.ip6_address ? [device.ip_address, device.ip6_address] : [device.ip_address])) : undefined;
    if (controller.signal.aborted || session !== store.sessionVersion) return;
    if (blocked.value || !config.value || modeChange.value && !acknowledgeMode.value) throw new Error(blocked.value || "The configuration changed. Review the policy mode and retry.");
    if (config.value.sando?.api_url !== savedSource) throw new Error("The saved Sando endpoint changed while fetching. Retry the import from the current endpoint; existing rules were retained.");
    // Merge into the latest shared draft, not a snapshot taken before the network requests.
    if (kind === "rules") {
      if (!connections) throw new Error("No successful rule source was returned; existing rules were retained.");
      const result = replaceSandoRules(config.value, inventory, connections, policy);
      stageImport(result, base, kind);
      notice.value += ` ${result.rulesRemoved} previous Sando rules replaced.`;
    } else stageImport(importSando(config.value, inventory, undefined, policy), base, kind);
  } catch (cause) {
    if (controller.signal.aborted) return;
    controller.abort();
    error.value = cause instanceof Error ? cause.message : "Sando import failed.";
  } finally {
    if (request === controller) { request = undefined; importing.value = null; }
  }
}
function stageImport(result: SandoImport, base: string, kind: "hosts" | "rules"): void {
    result.config.sando = { ...sandoSchema.parse(result.config.sando ?? {}), api_url: base };
    let reported = false;
    for (const [key, imported, omitted] of [
      ["hosts_import", result.hostsAdded, result.hostsSkipped],
      ["rules_import", result.rulesAdded, result.skipped.length - result.hostsSkipped],
    ] as const) {
      if (key === "rules_import" && kind !== "rules" || key === "hosts_import" && kind === "rules" && !result.hostsAdded) continue;
      if (!imported && omitted) continue;
      const count = (store.state.data?.desired.sando?.[key]?.import_count ?? 0) + 1;
      const previous = result.config.sando[key];
      const pending = key !== "rules_import" && previous?.import_count === count && previous.source_url === base ? previous : null;
      const skippedCount = Math.max(omitted, pending?.skipped_count ?? 0);
      result.config.sando[key] = sandoImportReportSchema.parse({
        source_url: base, import_count: count,
        last_import_at: pending?.last_import_at ?? new Date().toISOString(), status: skippedCount ? "partial" : "succeeded",
        imported_count: imported + (pending?.imported_count ?? 0), skipped_count: skippedCount,
      });
      reported = true;
    }
    const issues = validateConfig(result.config, store.runtime.data?.parent_interfaces, store.baseline ?? store.state.data?.desired);
    if (issues.length) throw new Error(issues.map(issue => `${issue.path}: ${issue.message}`).join("\n"));
    if (result.hostsAdded || result.rulesAdded || reported) {
      store.stage(result.config); endpoint.value = base; savedEndpoint.value = base; store.editorDirty = false;
    }
    skipped.value = result.skipped;
    notice.value = `${result.hostsAdded} hosts and ${result.rulesAdded} rules staged; ${result.duplicates} duplicates skipped.${result.hostsAdded || result.rulesAdded || reported ? " Review in SAVE." : ""}`;
}
watch(() => store.sessionVersion, () => {
  request?.abort();
  if (importing.value) error.value = "Sando import canceled because the firewall connection changed.";
  endpoint.value = savedEndpoint.value;
  notice.value = ""; skipped.value = [];
  store.editorDirty = false;
});
onBeforeUnmount(() => { request?.abort(); store.editorDirty = false; });
</script>

<template>
  <section aria-label="SANDO IMPORT">
    <h1 class="text-h5 mb-4">
      SANDO IMPORT
    </h1>
    <v-alert
      v-if="blockedNotice"
      type="warning"
      variant="tonal"
      class="mb-4"
    >
      {{ blockedNotice }}
    </v-alert>
    <v-alert
      v-if="error"
      type="error"
      class="mb-4"
      style="white-space: pre-wrap"
    >
      {{ error }}
    </v-alert>
    <v-alert
      v-if="notice"
      type="success"
      variant="tonal"
      class="mb-4"
    >
      {{ notice }}
    </v-alert>
    <v-text-field
      v-model="endpoint"
      label="Sando API endpoint"
      placeholder="https://sando.example/api"
      hide-details="auto"
      :disabled="Boolean(importing)"
      class="mb-4"
    />
    <v-btn
      :disabled="Boolean(importing) || Boolean(settingsBlocked)"
      class="mb-4"
      @click="saveEndpoint"
    >
      Save endpoint
    </v-btn>
    <div class="d-flex align-center flex-wrap ga-3 mb-4">
      <v-switch
        :key="String(config?.sando?.sync_enabled ?? false) + syncToggleVersion"
        :model-value="config?.sando?.sync_enabled ?? false"
        label="Automatic host and threat-score sync"
        :disabled="Boolean(importing) || Boolean(settingsBlocked)"
        color="primary"
        hide-details
        class="flex-grow-0"
        @update:model-value="setSync"
      />
      <v-chip
        v-if="config?.sando?.sync_enabled"
        size="small"
        variant="tonal"
        aria-label="Last Sando import"
      >
        Last import ({{ timeZone }}): {{ formatTimestamp(lastImportAt, "No imports yet") }}
      </v-chip>
    </div>
    <v-select
      v-model="newHostPolicy"
      label="New host default policy"
      :items="['accept', 'drop']"
      hide-details="auto"
      :disabled="Boolean(importing)"
      class="mb-4"
    />
    <v-checkbox
      v-if="modeChange"
      v-model="acknowledgeMode"
      label="Use host/interface policy mode with stateful return traffic instead of legacy forwarding mode"
      hide-details="auto"
      :disabled="Boolean(importing) || Boolean(blocked)"
      class="mb-4"
    />
    <div class="d-flex flex-wrap ga-3 mb-4">
      <v-btn
        color="primary"
        :disabled="disabled"
        :loading="importing === 'hosts'"
        @click="runImport('hosts')"
      >
        Import hosts
      </v-btn>
      <v-btn
        color="primary"
        :disabled="disabled"
        :loading="importing === 'rules'"
        @click="runImport('rules')"
      >
        Import rules
      </v-btn>
    </div>
    <v-alert
      v-if="skipped.length"
      type="warning"
      variant="tonal"
      class="mb-4"
    >
      Skipped entries:
      <ul>
        <li
          v-for="(reason, index) in skipped"
          :key="index"
        >
          {{ reason }}
        </li>
      </ul>
    </v-alert>
  </section>
</template>
