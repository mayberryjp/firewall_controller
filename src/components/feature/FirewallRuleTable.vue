<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import FieldInput from "@/components/base/FieldInput.vue";
import { cloneConfig, stableJson, validateConfig } from "@/services/configuration";
import { interfaceChoice } from "@/services/resourceCollections";
import { useControllerStore } from "@/stores/controller";
import type { Config } from "@/types/domain";
import type { Field } from "@/types/forms";
import { useFirewallCounters } from "@/composables/useFirewallCounters";
import FirewallCounterCells from "@/components/feature/FirewallCounterCells.vue";
import { firewallSystemRules, type FirewallSystemRule } from "@/services/firewallTelemetry";
import RuleOriginLabel from "@/components/feature/RuleOriginLabel.vue";
import { manualRuleOwnership } from "@/services/ruleOwnership";
import { firewallProtocolSchema, firewallProtocolChoices, supportsFirewallPorts, parseFirewallPorts, firewallProtocolNotice, formatFirewallProtocol } from "@/services/firewallProtocols";
import { useRuleDrag } from "@/composables/useRuleDrag";

type Rule = NonNullable<Config["firewall"]["policies"]>["hosts"][number]["rules"][number];
interface TableEntry {
  rule: FirewallSystemRule; index: number; system: boolean; override?: Rule;
}
const props = defineProps<{ scope: "host" | "interface" | "input"; owner: string }>();
const store = useControllerStore();
const selected = computed(() => store.draft ?? store.state.data?.active_transaction?.candidate ?? store.state.data?.desired);
const counters = useFirewallCounters(selected);
const counterPath = computed(() => {
  if (props.scope === "host") return `/firewall/policies/hosts/${selected.value?.firewall.policies?.hosts.findIndex(host => host.id === props.owner) ?? -1}`;
  const groups = props.scope === "interface" ? selected.value?.firewall.policies?.interfaces : selected.value?.firewall.input?.interfaces;
  return `${props.scope === "interface" ? "/firewall/policies" : "/firewall/input"}/interfaces/${groups?.findIndex(ingress => ingress.interface === props.owner) ?? -1}`;
});
const group = computed(() => props.scope === "host"
  ? selected.value?.firewall.policies?.hosts.find(host => host.id === props.owner)
  : props.scope === "interface"
    ? selected.value?.firewall.policies?.interfaces.find(ingress => ingress.interface === props.owner)
    : selected.value?.firewall.input?.interfaces.find(ingress => ingress.interface === props.owner));
const rules = computed(() => group.value?.rules ?? []);
const defaultAction = computed(() => {
  const value = group.value;
  return value && "policy" in value ? value.policy : undefined;
});
const blocked = computed(() => !selected.value || !props.owner || Boolean(store.readOnlyReason));
const editing = ref<number | "default" | null>(null);
const form = ref<Record<string, unknown>>({});
const initial = ref("");
const groupStart = ref("");
const error = ref("");
const { dropTarget, pointerStart, pointerMove, drop, cancel: cancelDrag } = useRuleDrag({
  blocked: () => blocked.value || editing.value !== null,
  snapshot: () => group.value,
  move,
  error: message => { error.value = message; },
});
const columns = computed<Array<{ key: keyof FirewallSystemRule; title: string }>>(() => [
  { key: "order", title: "Order" },
  ...(props.scope === "host" ? [{ key: "ingress" as const, title: "Ingress" }] : []),
  { key: "destination", title: "Destination" },
  { key: "protocol", title: "Protocol" }, { key: "ports", title: props.scope === "host" ? "Port" : "Ports" },
  ...(props.scope === "input" ? [] : [{ key: "egress" as const, title: "Egress" }]),
  { key: "action", title: "Action" },
]);
const fields = computed<Field[]>(() => editing.value === "default"
  ? [{ key: "action", label: "Default action", kind: "select", choices: ["accept", "drop"].map(value => ({ title: value, value })) }]
  : [
    ...(props.scope === "input" ? [] : [{
      key: "destination_host", label: "Destination host (blank = network / Any)", kind: "select" as const,
      choices: [{ title: "None", value: "" }, ...(selected.value?.firewall.policies?.hosts ?? []).map(host => ({ title: host.name, value: host.id }))],
    }]),
    { key: "destination", label: "Destination network (blank = Any)", kind: "text", disabled: Boolean(form.value.destination_host) },
    { key: "protocol", label: "Protocol", kind: "select", choices: firewallProtocolChoices },
    { key: "ports", label: "Destination ports (comma separated)", kind: "text", disabled: !supportsFirewallPorts(form.value.protocol) },
    ...(props.scope === "input" ? [] : [{
      key: "out_interface", label: "Egress interface", kind: "select" as const,
      choices: [{ title: "Any", value: "" }, ...(selected.value?.interfaces ?? []).map(interfaceChoice)],
    }]),
    { key: "action", label: "Action", kind: "select", choices: ["accept", "drop"].map(value => ({ title: value, value })) },
  ]);
const protocolNotice = computed(() => firewallProtocolNotice(form.value.protocol, form.value.action, selected.value?.firewall.allow_all_icmp ?? false));
const displayed = computed(() => [
  ...rules.value.map((rule, index) => display(rule, String(index + 1), `${counterPath.value}/rules/${index}`)),
  ...(typeof editing.value === "number" && editing.value === rules.value.length
    ? [display({ action: "accept" }, String(rules.value.length + 1), `${counterPath.value}/rules/${rules.value.length}`)] : []),
  ...(defaultAction.value ? [display({ action: defaultAction.value }, "Default", `${counterPath.value}/policy`)] : []),
]);
const tableLabel = computed(() => props.scope === "host" ? "Host rules" : props.scope === "input" ? "Input rules" : "Interface rules");
const sections = computed(() => {
  const systemRules = firewallSystemRules(selected.value, props.scope === "input" ? "input" : "forward");
  const system: TableEntry[] = systemRules.map((rule, index) => ({ rule, index, system: true }));
  const configured: TableEntry[] = displayed.value.map((rule, index) => ({ rule, index, system: false }));
  const overrides: TableEntry[] = props.scope === "host"
    ? (selected.value?.firewall.policies?.interfaces ?? []).flatMap((group, groupIndex) => group.rules.map((rule, index) => ({
      rule: display(rule, String(index + 1), `/firewall/policies/interfaces/${groupIndex}/rules/${index}`, group.interface),
      index, system: false, override: rule,
    }))) : [];
  return [
    { key: "system", label: "System Rules", title: "IPv4 ICMP, when enabled, then established/related connections. Existing connections may survive a new block until connection state expires or is explicitly deleted.", rows: system.filter(item => item.rule.order !== "Default") },
    { key: "interfaces", label: "Interface Overrides", title: "First matching verdict wins on the matching ingress interface. An interface allow overrides a host deny; an interface deny overrides a host allow. A catch-all prevents host rules from being reached on that interface.", rows: overrides },
    { key: "user", label: props.scope === "host" ? "Host Rules" : "User Rules", title: props.scope === "host" ? "Source-host rules apply only if no ingress-interface rule matched. The destination host's outbound policy is not evaluated." : "", rows: configured.filter(item => item.rule.order !== "Default") },
    { key: "defaults", label: "Default Rules", title: props.scope === "host" ? "The source host's default applies after its rules. The global default applies only to unknown source hosts." : "", rows: [
      ...configured.filter(item => item.rule.order === "Default"),
      ...system.filter(item => item.rule.order === "Default"),
    ] },
  ].filter(section => section.rows.length || section.key === "user");
});
function display(rule: Rule, order: string, path: string, ingress = "Any"): FirewallSystemRule {
  return {
    order, name: "", label: "", match: "", counterPath: path, ingress,
    destination: rule.destination_host
      ? selected.value?.firewall.policies?.hosts.find(host => host.id === rule.destination_host)?.name ?? `Unknown host (${rule.destination_host})`
      : rule.destination || "Any",
    protocol: formatFirewallProtocol(rule.protocol),
    ports: rule.destination_ports?.join(", ") || "Any",
    egress: rule.out_interface || "Any", action: rule.action,
  };
}
watch(form, () => { if (editing.value !== null) store.editorDirty = stableJson(form.value) !== initial.value; }, { deep: true });
onUnmounted(() => { if (editing.value !== null) store.editorDirty = false; });
function open(index: number | "default"): void {
  if (blocked.value || editing.value !== null) return;
  const rule = index === "default" ? { action: defaultAction.value } : rules.value[index] ?? { action: "accept" };
  form.value = { ...rule, ports: index === "default" ? "" : rules.value[index]?.destination_ports?.join(", ") ?? "" };
  initial.value = stableJson(form.value); groupStart.value = stableJson(group.value); editing.value = index; error.value = "";
}
function cancel(): void { editing.value = null; store.editorDirty = false; error.value = ""; }
function change(key: string, value: unknown): void {
  form.value = {
    ...form.value, [key]: value,
    ...(key === "destination_host" && value ? { destination: "" } : {}),
    ...(key === "protocol" && !supportsFirewallPorts(value) ? { ports: "" } : {}),
  };
}
function mutate(update: (candidate: Config, entries: Rule[]) => void): boolean {
  error.value = "";
  try {
    if (!selected.value || blocked.value) throw new Error(store.readOnlyReason || "Configuration unavailable");
    const candidate = cloneConfig(selected.value);
    let entries: Rule[];
    if (props.scope === "host") {
      const host = candidate.firewall.policies?.hosts.find(host => host.id === props.owner);
      if (!host) throw new Error("The selected host no longer exists.");
      entries = host.rules;
    } else {
      const groups = props.scope === "interface" ? candidate.firewall.policies?.interfaces : candidate.firewall.input?.interfaces;
      if (!groups) throw new Error("Configure the firewall policy before adding rules.");
      let ingress = groups.find(ingress => ingress.interface === props.owner);
      if (!ingress) { ingress = { interface: props.owner, rules: [] }; groups.push(ingress); }
      entries = ingress.rules;
    }
    update(candidate, entries);
    const prefix = props.scope === "input" ? "firewall.input" : "firewall.policies";
    const issues = validateConfig(candidate, store.runtime.data?.parent_interfaces, store.state.data?.desired)
      .filter(issue => issue.path.startsWith(prefix));
    if (issues.length) throw new Error(issues.map(issue => issue.message).join("; "));
    store.stage(candidate);
    return true;
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : "Unable to stage firewall rules.";
    return false;
  }
}
function save(): void {
  const index = editing.value;
  if (index === null) return;
  if (mutate((candidate, entries) => {
    if (stableJson(group.value) !== groupStart.value) throw new Error("These rules changed while editing. Cancel and reopen the editor.");
    if (form.value.action !== "accept" && form.value.action !== "drop") throw new Error("Choose accept or drop.");
    if (index === "default") {
      const host = candidate.firewall.policies?.hosts.find(host => host.id === props.owner);
      if (!host) throw new Error("The selected host no longer exists.");
      host.policy = form.value.action;
      return;
    }
    const rule: Rule = { ...(entries[index] ?? manualRuleOwnership), action: form.value.action };
    for (const key of ["destination", "destination_host", "out_interface"] as const) {
      const value = form.value[key];
      if (typeof value === "string" && value.trim()) rule[key] = value.trim();
      else delete rule[key];
    }
    const protocol = firewallProtocolSchema.parse(form.value.protocol === undefined ? "" : form.value.protocol);
    if (protocol) rule.protocol = protocol;
    else delete rule.protocol;
    const ports = parseFirewallPorts(form.value.ports);
    if (ports.length) rule.destination_ports = ports;
    else delete rule.destination_ports;
    if (index === entries.length) entries.push(rule);
    else {
      if (!entries[index]) throw new Error("The rule no longer exists. Cancel and reopen the editor.");
      entries[index] = rule;
    }
  })) cancel();
}
function remove(index: number): void {
  if (editing.value !== null) return;
  mutate((_, entries) => {
    if (!entries[index]) throw new Error("The rule no longer exists.");
    entries.splice(index, 1);
  });
}
function move(from: number, to: number): void {
  if (editing.value !== null || from === to || to < 0 || to >= rules.value.length) return;
  mutate((_, entries) => {
    const rule = entries.splice(from, 1)[0];
    if (!rule) throw new Error("The rule no longer exists.");
    entries.splice(to, 0, rule);
  });
}
</script>

<template>
  <div>
    <v-btn
      class="mb-3"
      prepend-icon="mdi-plus"
      :disabled="blocked || editing !== null"
      @click="open(rules.length)"
    >
      Add rule
    </v-btn>
    <v-alert
      v-if="error"
      type="error"
      role="alert"
      class="mb-3"
    >
      {{ error }}
    </v-alert>
    <v-table
      :aria-label="tableLabel"
      class="host-rules-table"
    >
      <caption class="d-sr-only">
        {{ tableLabel }}
      </caption>
      <thead>
        <tr>
          <th
            v-for="column in columns"
            :key="column.key"
            scope="col"
          >
            {{ column.title }}
          </th><th
            scope="col"
            class="rule-actions-heading"
          >
            Actions
          </th><th scope="col">
            Origin
          </th><th scope="col">
            Packets
          </th><th scope="col">
            Bytes
          </th>
        </tr>
      </thead>
      <tbody
        v-for="section in sections"
        :key="section.key"
        :class="`rule-section--${section.key}`"
      >
        <tr class="rule-section-heading">
          <th
            :colspan="columns.length + 4"
            scope="rowgroup"
            :title="section.title"
          >
            {{ section.label }}
          </th>
        </tr>
        <template
          v-for="{ rule, index, system, override } in section.rows"
          :key="rule.counterPath"
        >
          <tr
            v-if="system || override || editing !== (rule.order === 'Default' ? 'default' : index)"
            :class="{ 'host-rule': !system && !override, 'interface-rule': Boolean(override), 'system-rule': system, 'host-rule--default': !system && !override && rule.order === 'Default', 'system-rule--default': system && rule.order === 'Default', 'rule-drop-target': !system && !override && dropTarget === index }"
            :title="override ? 'Interface override; counters cover all source hosts. Edit on Interface Rules.' : system ? [rule.label, rule.match].filter(Boolean).join('; ') : undefined"
            :data-action="rule.action"
            :data-rule-index="system || override || rule.order === 'Default' ? undefined : index"
          >
            <td
              v-for="column in columns"
              :key="column.key"
            >
              <span class="compact-cell-label">{{ column.title }}</span>
              <span
                class="rule-value"
                :aria-label="system && column.key === 'order' ? [rule.label, rule.match].filter(Boolean).join('; ') : undefined"
                :class="{ 'rule-value--any': rule[column.key] === 'Any', 'rule-value--order': column.key === 'order', 'rule-value--ingress': column.key === 'ingress' }"
              >
                <v-chip
                  v-if="column.key === 'action'"
                  :color="rule.action === 'accept' ? 'success' : 'error'"
                  :prepend-icon="rule.action === 'accept' ? 'mdi-check-circle-outline' : 'mdi-close-circle-outline'"
                  variant="tonal"
                  size="small"
                  class="rule-chip rule-action"
                >{{ rule.action }}</v-chip>
                <v-chip
                  v-else-if="column.key === 'protocol' && rule.protocol !== 'Any'"
                  :color="rule.protocol === 'TCP' ? 'info' : 'secondary'"
                  variant="tonal"
                  size="small"
                  class="rule-chip"
                >{{ rule.protocol }}</v-chip>
                <v-chip
                  v-else-if="column.key === 'ports' && rule.ports !== 'Any'"
                  variant="tonal"
                  size="small"
                  class="rule-chip"
                >{{ rule.ports }}</v-chip>
                <v-chip
                  v-else-if="(column.key === 'egress' || column.key === 'ingress') && rule[column.key] !== 'Any'"
                  color="primary"
                  prepend-icon="mdi-lan-connect"
                  variant="outlined"
                  size="small"
                  class="rule-chip"
                >{{ rule[column.key] }}</v-chip>
                <span v-else>{{ system && column.key === 'order' ? scope === 'host' && rule.order === 'Default' ? 'Global' : rule.name : rule[column.key] }}</span>
              </span>
            </td>
            <td class="rule-actions">
              <span
                v-if="system || override"
                :title="override ? 'Edit on Interface Rules' : 'Read-only system rule'"
                :aria-label="override ? 'Edit on Interface Rules' : 'Read-only system rule'"
              >—</span>
              <template v-else>
                <button
                  v-if="rule.order !== 'Default'"
                  type="button"
                  class="drag-handle"
                  :aria-label="`Drag rule ${index + 1}`"
                  :disabled="blocked || editing !== null"
                  @pointerdown="pointerStart($event, index)"
                  @pointermove="pointerMove"
                  @pointerup="drop"
                  @pointercancel="cancelDrag"
                >
                  <v-icon icon="mdi-drag" />
                </button>
                <button
                  type="button"
                  :aria-label="rule.order === 'Default' ? 'Edit default action' : `Edit rule ${index + 1}`"
                  :disabled="blocked || editing !== null"
                  @click="open(rule.order === 'Default' ? 'default' : index)"
                >
                  <v-icon icon="mdi-pencil" />
                </button>
                <template v-if="rule.order !== 'Default'">
                  <button
                    type="button"
                    :aria-label="`Delete rule ${index + 1}`"
                    :disabled="blocked || editing !== null"
                    @click="remove(index)"
                  >
                    <v-icon
                      icon="mdi-delete"
                      color="error"
                    />
                  </button>
                </template>
              </template>
            </td>
            <td>
              <span class="compact-cell-label">Origin</span>
              <RuleOriginLabel :rule="override ?? (system || rule.order === 'Default' ? { origin: 'system' } : rules[index] ?? manualRuleOwnership)" />
            </td>
            <FirewallCounterCells :counts="counters.counts(rule.counterPath, scope === 'input' ? 'input' : 'forward')" />
          </tr>
          <tr
            v-else
            class="rule-editor"
          >
            <td :colspan="columns.length + 4">
              <form @submit.prevent="save">
                <p
                  v-if="protocolNotice"
                  class="text-warning text-caption mb-3"
                >
                  {{ protocolNotice }}
                </p>
                <div class="rule-fields">
                  <FieldInput
                    v-for="field in fields"
                    :key="field.key"
                    :field="{ ...field, disabled: blocked || field.disabled }"
                    :model-value="form[field.key]"
                    :path="`rule.${field.key}`"
                    @update:model-value="change(field.key, $event)"
                  />
                </div>
                <div class="d-flex ga-2 mt-3">
                  <v-btn
                    type="submit"
                    :disabled="blocked"
                  >
                    Save rule
                  </v-btn><v-btn @click="cancel">
                    Cancel
                  </v-btn>
                </div>
              </form>
            </td>
          </tr>
        </template>
        <tr v-if="section.key === 'user' && !section.rows.length && editing === null">
          <td :colspan="columns.length + 4">
            {{ scope === 'host' ? 'No explicit rules for this host.' : 'No explicit ingress rules for this interface.' }}
          </td>
        </tr>
      </tbody>
    </v-table>
    <p class="text-caption text-medium-emphasis mt-2">
      {{ counters.notice.value }}
    </p>
  </div>
</template>

<style scoped>
.host-rules-table { container-type: inline-size; border: 1px solid rgba(var(--v-theme-on-surface), 0.1); border-radius: 12px; }
.host-rules-table :deep(table) { width: 100%; table-layout: auto; }
.host-rules-table :deep(th), .host-rules-table :deep(td) { padding: 4px 8px; white-space: normal; overflow-wrap: anywhere; }
.host-rules-table :deep(th) { background: rgb(var(--v-theme-surface-variant)); }
.host-rules-table :deep(.counter-label) { display: none; }
.rule-actions-heading { width: 96px; }
.rule-actions { white-space: nowrap !important; }
.host-rules-table :deep(.rule-section-heading th) { height: 28px; border-top: 1px solid rgba(var(--v-theme-on-surface), 0.2) !important; font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.65); }
.host-rule, .system-rule, .interface-rule { --rule-color: var(--v-theme-success); }
.host-rule[data-action="drop"], .system-rule[data-action="drop"], .interface-rule[data-action="drop"] { --rule-color: var(--v-theme-error); }
.host-rule > td:first-child, .system-rule > td:first-child, .interface-rule > td:first-child { border-inline-start: 3px solid rgba(var(--rule-color), 0.65); }
.host-rule--default { background: rgba(var(--v-theme-on-surface), 0.025); }
.host-rule--default > td, .system-rule--default > td { border-top: 1px dashed rgba(var(--v-theme-on-surface), 0.2); }
.rule-value { display: inline-flex; align-items: center; max-width: 100%; min-width: 0; }
.rule-value--any { color: rgba(var(--v-theme-on-surface), 0.5); font-size: 13px; }
.rule-value--order { padding: 3px 8px; border-radius: 8px; background: rgba(var(--v-theme-primary), 0.1); }
.rule-chip { max-width: 100%; height: auto; min-height: 26px; padding-block: 4px; }
.rule-chip :deep(.v-chip__content) { min-width: 0; white-space: normal; overflow-wrap: anywhere; }
.rule-action { font-weight: 700; }
.rule-actions button { min-width: 28px; min-height: 32px; border-radius: 4px; }
.rule-actions button:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); }
.rule-actions button:disabled { opacity: 0.4; }
.rule-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap: 12px; }
.compact-cell-label { display: none; }
@media (min-width: 600px) {
  .host-rules-table :deep(table) { min-width: 1100px; }
  .host-rules-table :deep(th), .host-rules-table :deep(td), .rule-chip :deep(.v-chip__content) { white-space: nowrap; overflow-wrap: normal; }
}
@media (max-width: 599px) {
  .host-rules-table :deep(table), .host-rules-table :deep(tbody) { display: block; width: 100%; }
  .host-rules-table :deep(thead) { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .host-rules-table :deep(tbody > tr) { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); padding: 6px; }
  .host-rules-table :deep(.v-table__wrapper > table > tbody > tr > td) { min-width: 0; height: auto; padding: 8px; border: 0; }
  .host-rules-table :deep(.rule-editor) { grid-template-columns: minmax(0, 1fr); }
  .host-rules-table :deep(.rule-section-heading) { display: block; padding: 0; }
  .host-rules-table :deep(.rule-section-heading th) { display: block; padding: 6px 8px; height: auto; }
  .system-rule .rule-actions, .interface-rule .rule-actions { display: none; }
  .rule-actions { grid-column: 1 / -1; }
  .host-rules-table :deep(.counter-label) { display: block; margin-bottom: 2px; color: rgba(var(--v-theme-on-surface), 0.6); font-size: 12px; }
  .compact-cell-label { display: block; margin-bottom: 6px; color: rgba(var(--v-theme-on-surface), 0.6); font-size: 11px; }
}
</style>
