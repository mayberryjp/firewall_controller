<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { ZodError } from "zod";
import { useControllerStore } from "@/stores/controller";
import {
  configSchema, interfaceSchema, routeSchema, policySchema, filterSchema, masqueradeSchema, softflowdSchema, type Config, type ManagedInterface,
} from "@/types/domain";
import { record } from "@/types/forms";
import { preset, resourceFields, type Section } from "@/services/resourceForms";
import { cloneConfig, differences, prefix, stableJson, validateConfig } from "@/services/configuration";
import DatasetStatus from "@/components/base/DatasetStatus.vue";
import FieldInput from "@/components/base/FieldInput.vue";
import JsonPanel from "@/components/base/JsonPanel.vue";
const route = useRoute(), store = useControllerStore();
const section = computed<Section>(() => {
  if (route.path.startsWith("/services")) return "softflowd";
  if (route.path.startsWith("/wireguard") || route.path.startsWith("/interfaces")) return "interfaces";
  if (route.path.startsWith("/policy-rules")) return "policy_rules";
  if (route.path.startsWith("/firewall")) return "firewall";
  if (route.path.startsWith("/nat")) return "nat";
  return "routes";
});
const wireguard = computed(() => route.path === "/wireguard");
const titles: Record<Section, string> = {
  interfaces: "Managed interfaces", routes: "Routes", policy_rules: "Source-policy routing",
  firewall: "Firewall forwarding", nat: "NAT masquerading", softflowd: "softflowd",
};
const descriptions: Record<Section, string> = {
  interfaces: "Administrative up is not carrier/readiness. VLAN identity is immutable. All edits stage into one complete shared draft.",
  routes: "Unicast routes owned under protocol 242 and tables 10000..19999. No physical interfaces or protected parents.",
  policy_rules: "Source-prefix table lookup only. Unique priority; multiple rules may share a table.",
  firewall: "Owns only inet netcontrol forward chain, not host input or management-listener policy. Order is significant. No port/protocol matches.",
  nat: "Masquerading does not enable forwarding, create routes, or bypass filter rules. Order is preserved.",
  softflowd: "Runtime responsiveness is not delivery verification. Reconcile affects all managed services using stored configuration, never the local draft.",
};
const showDraft = ref(false), search = ref(""), kindFilter = ref("All"), adminFilter = ref("All"), interfaceFilter = ref("All"), familyFilter = ref("All"), tableFilter = ref("");
const dialog = ref(false), form = ref<Record<string, unknown>>({}), original = ref<unknown>(), editingIndex = ref(-1);
const renameAcknowledged = ref(false);
const formStart = ref(""), errors = ref<Record<string, string[]>>({}), formError = ref("");
const summary = ref<HTMLElement | null>(null), deletion = ref<{ index: number; value: unknown } | null>(null);
const policy = ref<"accept" | "drop">("accept"), serviceDialog = ref(false), serviceError = ref("");
const selectedConfig = computed(() => showDraft.value && store.draft ? store.draft : store.state.data?.desired);
const editingConfig = computed(() => store.draft ?? store.state.data?.desired);
function items(config: Config): unknown[] {
  switch (section.value) {
    case "firewall": return config.firewall.rules;
    case "nat": return config.firewall.nat.masquerade;
    default: return config[section.value];
  }
}
function replaceItems(config: Config, values: unknown[]): void {
  switch (section.value) {
    case "interfaces": config.interfaces = values.map(value => interfaceSchema.parse(value)); break;
    case "routes": config.routes = values.map(value => routeSchema.parse(value)); break;
    case "policy_rules": config.policy_rules = values.map(value => policySchema.parse(value)); break;
    case "firewall": config.firewall.rules = values.map(value => filterSchema.parse(value)); break;
    case "nat": config.firewall.nat.masquerade = values.map(value => masqueradeSchema.parse(value)); break;
    case "softflowd": config.softflowd = values.map(value => softflowdSchema.parse(value)); break;
  }
}
const rows = computed(() => selectedConfig.value ? items(selectedConfig.value).map((value, index) => ({
  value: record(value), index,
  rowID: `${stableJson(value)}/${items(selectedConfig.value!).slice(0, index).filter(item => stableJson(item) === stableJson(value)).length}`,
})).filter(({ value }) => {
  if (route.params.name && value.name !== route.params.name) return false;
  if (wireguard.value && value.kind !== "wireguard") return false;
  if (kindFilter.value !== "All" && value.kind !== kindFilter.value) return false;
  if (adminFilter.value !== "All" && value.up !== (adminFilter.value === "Up")) return false;
  if (interfaceFilter.value !== "All" && value.interface !== interfaceFilter.value) return false;
  if (tableFilter.value && String(value.table) !== tableFilter.value) return false;
  if (familyFilter.value !== "All") {
    try { if (prefix(String(value.destination || value.source), true).family !== familyFilter.value) return false; } catch { return false; }
  }
  return JSON.stringify(value).toLowerCase().includes(String(search.value ?? "").toLowerCase());
}) : []);
const allManaged = computed(() => editingConfig.value?.interfaces.map(link => link.name) ?? []);
const adopted = computed(() => store.runtime.data?.parent_interfaces.filter(parent => parent.available).map(parent => parent.name) ?? []);
const parentOptions = computed(() => editingConfig.value?.interfaces.filter(link => {
  if (link.kind === "wireguard" || link.name === form.value.name) return false;
  const visited = new Set<string>();
  let parent: ManagedInterface = link;
  while (parent.kind === "vlan") {
    if (parent.vlan.parent === form.value.name || visited.has(parent.name)) return false;
    visited.add(parent.name);
    const next = editingConfig.value?.interfaces.find(candidate => candidate.name === (parent.kind === "vlan" ? parent.vlan.parent : ""));
    if (!next) break;
    parent = next;
  }
  return true;
}).map(link => link.name) ?? []);
const familyInterfaces = computed(() => editingConfig.value?.interfaces.filter(link => link.addresses.some(address => {
  try { return prefix(address, false).family === form.value.family; } catch { return false; }
})).map(link => link.name) ?? []);
const immutable = computed(() => Boolean(original.value && store.state.data?.desired.interfaces.some(link => link.name === record(original.value).name)));
const fields = computed(() => resourceFields(section.value, section.value === "interfaces" ? parentOptions.value : allManaged.value,
  adopted.value, immutable.value, form.value.kind, form.value.family, familyInterfaces.value));
const columns = computed(() => {
  switch (section.value) {
    case "interfaces": return ["name", "kind", "up", "mtu", "addresses", "vlan"];
    case "routes": return ["destination", "gateway", "interface", "table", "metric"];
    case "policy_rules": return ["priority", "source", "table"];
    case "firewall": return ["source", "destination", "action"];
    case "nat": return ["family", "source", "out_interface"];
    case "softflowd": return ["name", "enabled", "interface", "collector", "export_version"];
  }
  return [];
});
function dependencies(name: unknown): string[] {
  if (!editingConfig.value || section.value !== "interfaces") return [];
  const config = editingConfig.value;
  return [
    ...config.interfaces.filter(link => link.kind === "vlan" && link.vlan.parent === name).map(link => `Child VLAN ${link.name}`),
    ...config.routes.filter(item => item.interface === name).map(item => `Route ${item.destination}`),
    ...config.firewall.nat.masquerade.filter(item => item.out_interface === name).map((_, index) => `Masquerade reference ${index + 1}`),
    ...config.softflowd.filter(item => item.interface === name).map(item => `Capture instance ${item.name}`),
  ];
}
const impacts = computed(() => deletion.value ? dependencies(record(deletion.value.value).name) : []);
const renaming = computed(() => section.value === "interfaces" && original.value !== undefined && record(original.value).name !== form.value.name);
const renameImpacts = computed(() => renaming.value ? dependencies(record(original.value).name) : []);
function display(value: unknown, key: string): string {
  if (value === undefined || value === "") return ["source", "destination"].includes(key) ? "Any" : key === "gateway" ? "Direct" : "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
function observedEnabled(name: unknown): string {
  const observed = configSchema.safeParse(store.state.data?.observed);
  if (!observed.success) return "Unknown";
  const service = observed.data.softflowd.find(item => item.name === name);
  return service ? (service.enabled ? "Yes" : "No") : "Unknown (not observed)";
}
function beginPreview(): void {
  try {
    if (!store.draft && store.state.data) store.stage(cloneConfig(store.state.data.desired));
    showDraft.value = true;
  } catch (error) { formError.value = error instanceof Error ? error.message : "Unable to start draft"; }
}
function runtime(name: unknown): string {
  const status = store.runtime.data?.softflowd.find(item => item.name === name);
  if (!status) return "Unknown";
  const labels: Record<string, string> = {
    running: "Running; local responsiveness checked, delivery not verified",
    disabled: "Disabled", simulated: "Simulated; no real process", not_running: "Not running",
    unhealthy: "Unhealthy", exited: "Exited",
  };
  return `${labels[status.state] ?? `Unknown (${status.state})`}${status.pid ? ` · PID ${status.pid}` : ""}${status.started_at ? ` · ${status.started_at}` : ""}${status.error ? ` · ${status.error}` : ""}`;
}
function staged(value: unknown): string {
  if (!store.draft || !store.state.data) return "Committed desired";
  const changes = differences(store.state.data.desired, store.draft).filter(item => item.area === (section.value === "policy_rules" ? "policy-rules" : section.value));
  const name = record(value).name;
  return changes.some(item => name ? item.identity === name : stableJson(item.before) === stableJson(value) || stableJson(item.after) === stableJson(value)) ? "Staged change" : "Unchanged";
}
function open(value?: unknown): void {
  if (!editingConfig.value) return;
  original.value = value;
  editingIndex.value = value === undefined ? -1 : items(editingConfig.value).findIndex(item =>
    record(value).name ? record(item).name === record(value).name : stableJson(item) === stableJson(value));
  if (value !== undefined && editingIndex.value < 0) { formError.value = "This committed record was removed/changed in the shared draft. Switch to draft preview."; return; }
  const initial = editingIndex.value >= 0 ? items(editingConfig.value)[editingIndex.value] : preset(section.value, wireguard.value);
  form.value = record(JSON.parse(JSON.stringify(initial)));
  formStart.value = stableJson(form.value); errors.value = {}; formError.value = ""; dialog.value = true;
  renameAcknowledged.value = false;
}
function change(key: string, value: unknown): void {
  const next = { ...form.value, [key]: value };
  if (section.value === "interfaces" && key === "kind") {
    delete next.vlan; delete next.wireguard;
    if (value === "vlan") next.vlan = { parent: "", id: 1 };
    if (value === "wireguard") next.wireguard = { key_ref: "", listen_port: 51820, peers: [] };
  }
  form.value = next;
}
watch(form, () => { if (dialog.value) store.editorDirty = stableJson(form.value) !== formStart.value; }, { deep: true });
function cancel(): void {
  if (store.editorDirty && !window.confirm("Discard unstaged form input?")) return;
  dialog.value = false; store.editorDirty = false; form.value = {};
}
watch(() => route.fullPath, () => {
  dialog.value = false; store.editorDirty = false; formError.value = "";
  showDraft.value = false;
  search.value = ""; kindFilter.value = "All"; adminFilter.value = "All"; interfaceFilter.value = "All"; familyFilter.value = "All"; tableFilter.value = "";
});
onUnmounted(() => { store.editorDirty = false; });
async function stageForm(): Promise<void> {
  if (!editingConfig.value) return;
  errors.value = {}; formError.value = "";
  try {
    if (renaming.value && !renameAcknowledged.value) throw new Error("Review and acknowledge interface rename dependency impacts first");
    const value = JSON.parse(JSON.stringify(form.value)) as Record<string, unknown>;
    if (section.value === "softflowd") {
      const timeouts = record(value.timeouts);
      value.timeouts = Object.fromEntries(Object.entries(timeouts).filter(([, seconds]) => seconds !== "" && seconds !== undefined));
    }
    const candidate = cloneConfig(editingConfig.value);
    const values = [...items(candidate)], index = editingIndex.value < 0 ? values.length : editingIndex.value;
    values[index] = value;
    replaceItems(candidate, values);
    const basePath = section.value === "firewall" ? `firewall.rules.${index}` : section.value === "nat" ? `firewall.nat.masquerade.${index}` : `${section.value}.${index}`;
    const ownIssues = validateConfig(candidate, store.runtime.data?.parent_interfaces, store.state.data?.desired).filter(issue =>
      issue.path === basePath || issue.path.startsWith(`${basePath}.`));
    for (const issue of ownIssues) {
      const key = issue.path.replace(basePath, "editor").replace(/\.(addresses|allowed_ips)\.\d+$/, ".$1");
      errors.value[key] = [...(errors.value[key] ?? []), issue.message];
    }
    if (ownIssues.length) throw new Error("Correct the highlighted local validation errors. Cross-resource errors remain visible in Review changes.");
    store.stage(candidate); dialog.value = false; store.editorDirty = false; showDraft.value = true;
  } catch (error) {
    if (error instanceof ZodError) {
      for (const issue of error.issues) {
        const key = `editor.${issue.path.join(".")}`;
        errors.value[key] = [...(errors.value[key] ?? []), issue.message];
      }
    }
    formError.value = error instanceof Error ? error.message : "Unable to stage record";
    await nextTick(); summary.value?.focus();
  }
}
function stageDelete(): void {
  if (!editingConfig.value || !deletion.value) return;
  try {
    const candidate = cloneConfig(editingConfig.value);
    const value = deletion.value.value;
    const values = items(candidate);
    const index = values.findIndex(item => record(value).name ? record(item).name === record(value).name : stableJson(item) === stableJson(value));
    if (index < 0) throw new Error("Record no longer exists in draft");
    replaceItems(candidate, values.filter((_, i) => i !== index));
    store.stage(candidate); showDraft.value = true; deletion.value = null;
  } catch (error) { formError.value = error instanceof Error ? error.message : "Unable to stage deletion"; }
}
function move(index: number, delta: number): void {
  if (!editingConfig.value) return;
  try {
    const candidate = cloneConfig(editingConfig.value), values = [...items(candidate)];
    [values[index], values[index + delta]] = [values[index + delta], values[index]];
    replaceItems(candidate, values); store.stage(candidate); showDraft.value = true;
  } catch (error) { formError.value = error instanceof Error ? error.message : "Unable to reorder"; }
}
function stagePolicy(): void {
  if (!editingConfig.value) return;
  try { const candidate = cloneConfig(editingConfig.value); candidate.firewall.policy = policy.value; store.stage(candidate); showDraft.value = true; }
  catch (error) { formError.value = error instanceof Error ? error.message : "Unable to stage policy"; }
}
watch(() => editingConfig.value?.firewall.policy, value => { if (value) policy.value = value; }, { immediate: true });
async function reconcile(): Promise<void> {
  try { serviceError.value = ""; await store.reconcile(); serviceDialog.value = false; }
  catch (error) { serviceError.value = error instanceof Error ? error.message : "Reconcile failed"; }
}
</script>
<template>
  <section>
    <h1 class="text-h4 mb-4">
      {{ wireguard ? "WireGuard" : titles[section] }}{{ route.params.name ? ` · ${route.params.name}` : "" }}
    </h1>
    <p class="mb-5">
      {{ descriptions[section] }}
    </p>
    <DatasetStatus
      :query="store.state"
      label="Configuration"
    />
    <v-alert
      v-if="store.readOnlyReason"
      type="warning"
      variant="tonal"
      class="mb-4"
    >
      {{ store.readOnlyReason }}
    </v-alert>
    <v-alert
      v-if="formError && !dialog"
      type="error"
      class="mb-4"
    >
      {{ formError }}
    </v-alert>
    <div class="d-flex flex-wrap align-center ga-3 mb-5">
      <v-btn
        color="primary"
        :disabled="Boolean(store.readOnlyReason)"
        @click="open()"
      >
        Add {{ section === "interfaces" ? "interface" : section === "softflowd" ? "instance" : "rule / route" }}
      </v-btn>
      <v-switch
        v-model="showDraft"
        :disabled="!store.draft"
        label="Show staged draft (otherwise committed desired)"
        hide-details
        color="primary"
      />
      <v-btn
        v-if="!showDraft"
        variant="text"
        :disabled="Boolean(store.readOnlyReason)"
        @click="beginPreview"
      >
        Start / show shared draft
      </v-btn>
    </div>
    <div class="filter-grid">
      <v-text-field
        v-model="search"
        label="Filter text"
        clearable
      />
      <template v-if="section === 'interfaces'">
        <v-select
          v-model="kindFilter"
          :items="['All', 'dummy', 'vlan', 'wireguard']"
          label="Kind"
        />
        <v-select
          v-model="adminFilter"
          :items="['All', 'Up', 'Down']"
          label="Administrative state"
        />
      </template>
      <template v-if="section === 'routes'">
        <v-select
          v-model="interfaceFilter"
          :items="['All', ...allManaged]"
          label="Interface"
        />
        <v-select
          v-model="familyFilter"
          :items="['All', 'ipv4', 'ipv6']"
          label="Family"
        />
        <v-text-field
          v-model="tableFilter"
          label="Table"
          type="number"
        />
      </template>
    </div>
    <template v-if="section === 'firewall'">
      <div class="d-flex flex-wrap ga-3 align-center mb-4">
        <v-select
          v-model="policy"
          label="Draft default policy"
          :items="['accept', 'drop']"
          hide-details
        />
        <v-btn
          :disabled="Boolean(store.readOnlyReason)"
          @click="stagePolicy"
        >
          Stage policy change
        </v-btn>
      </div>
      <v-alert
        v-if="selectedConfig?.firewall.policy === 'drop' || selectedConfig?.firewall.rules.some(item => !item.source && !item.destination)"
        type="warning"
        class="mb-4"
      >
        Default drop or catch-all rule: later rules can be unreachable. Acknowledgement is required at review for drop policy/catch-all drop.
      </v-alert>
    </template>
    <template v-if="section === 'softflowd'">
      <DatasetStatus
        :query="store.runtime"
        label="Service runtime"
      />
      <v-alert
        v-if="store.runtime.data?.error"
        type="warning"
        class="mb-4"
      >
        {{ store.runtime.data.error }}
      </v-alert>
      <v-btn
        class="mb-4"
        :disabled="store.busy || store.incompatible || Boolean(store.uncertain) || store.activeTransactions.some(item => ['applying', 'rolling_back', 'recovery_failed'].includes(item.status))"
        @click="serviceDialog = true"
      >
        Reconcile all managed services
      </v-btn>
    </template>
    <v-table v-if="selectedConfig">
      <thead>
        <tr>
          <th v-if="['firewall', 'nat'].includes(section)">
            Position
          </th><th
            v-for="key in columns"
            :key="key"
          >
            {{ key.replaceAll("_", " ") }}
          </th>
          <th v-if="section === 'softflowd'">
            Observed enabled / runtime
          </th><th>Staged state / diagnostics</th><th>Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.rowID"
        >
          <td v-if="['firewall', 'nat'].includes(section)">
            {{ row.index + 1 }}
          </td>
          <td
            v-for="key in columns"
            :key="key"
            class="mono"
          >
            {{ display(row.value[key], key) }}
          </td>
          <td v-if="section === 'softflowd'">
            {{ observedEnabled(row.value.name) }}<br>{{ runtime(row.value.name) }}
          </td>
          <td>
            {{ staged(row.value) }}<JsonPanel
              :value="row.value"
              label="Full configured fields / public keys"
            />
            <router-link
              v-if="row.value.name && ['interfaces', 'softflowd'].includes(section)"
              :to="`${section === 'softflowd' ? '/services/softflowd' : '/interfaces'}/${encodeURIComponent(String(row.value.name))}`"
            >
              Detail
            </router-link>
          </td>
          <td>
            <div class="d-flex flex-wrap ga-2 py-2">
              <v-btn
                size="small"
                :disabled="Boolean(store.readOnlyReason)"
                @click="open(row.value)"
              >
                Edit / stage
              </v-btn>
              <v-btn
                size="small"
                color="error"
                variant="text"
                :disabled="Boolean(store.readOnlyReason)"
                @click="deletion = { index: row.index, value: row.value }"
              >
                Delete
              </v-btn>
              <template v-if="['firewall', 'nat'].includes(section) && showDraft">
                <v-btn
                  size="small"
                  :disabled="Boolean(store.readOnlyReason) || row.index === 0"
                  @click="move(row.index, -1)"
                >
                  Move up
                </v-btn>
                <v-btn
                  size="small"
                  :disabled="Boolean(store.readOnlyReason) || row.index === items(selectedConfig).length - 1"
                  @click="move(row.index, 1)"
                >
                  Move down
                </v-btn>
              </template>
            </div>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 4">
            {{ route.params.name ? "Resource not found in this configuration." : "No matching configured resources." }}
          </td>
        </tr>
      </tbody>
    </v-table>
    <template v-if="route.params.name && store.state.data">
      <JsonPanel
        :value="store.state.data.desired"
        label="Committed desired (read-only)"
      />
      <JsonPanel
        :value="store.state.data.observed"
        label="Observed configuration (read-only; may be unavailable/incompatible)"
      />
    </template>
    <v-dialog
      :model-value="dialog"
      max-width="900"
      persistent
      scrollable
    >
      <v-card :title="`${editingIndex < 0 ? 'Add' : 'Edit'} ${titles[section]} — local draft only`">
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
              v-model="renameAcknowledged"
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
            v-if="formError"
            ref="summary"
            tabindex="-1"
            role="alert"
            class="mb-4"
          >
            <v-alert type="error">
              {{ formError }}
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
            @update:model-value="change(field.key, $event)"
          />
        </v-card-text>
        <v-card-actions>
          <v-btn @click="cancel">
            Cancel
          </v-btn><v-btn
            color="primary"
            :disabled="Boolean(store.readOnlyReason)"
            @click="stageForm"
          >
            Stage changes
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <v-dialog
      :model-value="deletion !== null"
      max-width="620"
      @update:model-value="!$event && (deletion = null)"
    >
      <v-card title="Stage deletion — no server write">
        <v-card-text>
          <p>No dependent resource is silently removed. Stage explicit reference updates/removals; invalid references block apply.</p>
          <ul>
            <li
              v-for="impact in impacts"
              :key="impact"
            >
              {{ impact }}
            </li>
          </ul>
          <JsonPanel
            :value="deletion?.value"
            label="Resource to delete"
          />
        </v-card-text>
        <v-card-actions>
          <v-btn @click="deletion = null">
            Cancel
          </v-btn><v-btn
            color="error"
            @click="stageDelete"
          >
            Stage deletion
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <v-dialog
      v-model="serviceDialog"
      max-width="620"
    >
      <v-card title="Reconcile all managed services?">
        <v-card-text>
          Uses committed/pending stored configuration, not the draft. May lose flow caches. Does not replay networking or create a revision. No automatic retry.
          <v-alert
            v-if="serviceError"
            type="error"
            class="mt-3"
          >
            {{ serviceError }}
          </v-alert>
        </v-card-text>
        <v-card-actions>
          <v-btn @click="serviceDialog = false">
            Cancel
          </v-btn><v-btn
            color="warning"
            :loading="store.busy"
            @click="reconcile"
          >
            Reconcile all services
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>
