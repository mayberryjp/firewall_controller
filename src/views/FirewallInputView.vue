<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { ZodError } from "zod";
import { useControllerStore } from "@/stores/controller";
import { inputFirewallSchema } from "@/types/domain";
import { record, type Field } from "@/types/forms";
import { cloneConfig, stableJson, validateConfig } from "@/services/configuration";
import FieldInput from "@/components/base/FieldInput.vue";
import { metadataFields } from "@/services/resourceForms";
import { interfaceChoice } from "@/services/resourceCollections";

const store = useControllerStore();
const selected = computed(() => store.draft ?? store.state.data?.active_transaction?.candidate ?? store.state.data?.desired);
const input = computed(() => selected.value?.firewall.input);
const dialog = ref(false), enabled = ref(false), form = ref<Record<string, unknown>>({});
const initial = ref(""), error = ref(""), errors = ref<Record<string, string[]>>({});
const snapshot = () => stableJson({ enabled: enabled.value, settings: form.value });
function reset(): void {
  enabled.value = Boolean(input.value);
  form.value = record(JSON.parse(JSON.stringify(input.value ?? { policy: "drop", interfaces: [] })));
  initial.value = snapshot(); store.editorDirty = false; error.value = ""; errors.value = {};
}
watch(selected, () => { if (!dialog.value) reset(); }, { immediate: true });
watch([enabled, form], () => { if (dialog.value) store.editorDirty = snapshot() !== initial.value; }, { deep: true });
onUnmounted(() => { store.editorDirty = false; });
const fields = computed<Field[]>(() => metadataFields([
  { key: "policy", label: "Input default policy", kind: "select", choices: ["accept", "drop"].map(value => ({ title: value, value })) },
  {
    key: "interfaces", label: "Ingress interfaces", kind: "rows", create: () => ({ interface: "", rules: [] }),
    fields: [
      { key: "interface", label: "Managed ingress interface", kind: "select", choices: (selected.value?.interfaces ?? []).map(interfaceChoice) },
      {
        key: "rules", label: "Input rules", kind: "rows", create: () => ({ action: "accept", destination: "", protocol: "", destination_ports: [] }),
        fields: [
          { key: "destination", label: "Destination network (blank = Any)", kind: "text" },
          { key: "protocol", label: "Protocol", kind: "select", choices: [{ title: "Any", value: "" }, { title: "TCP", value: "tcp" }, { title: "UDP", value: "udp" }] },
          { key: "destination_ports", label: "Destination ports", kind: "lines", hint: "One TCP/UDP port per line; blank matches any port." },
          { key: "action", label: "Action", kind: "select", choices: ["accept", "drop"].map(value => ({ title: value, value })) },
        ],
      },
    ],
  },
], false));
const rows = computed(() => input.value?.interfaces.flatMap(ingress => ingress.rules.map((rule, index) => ({ interface: ingress.interface, rule, index }))) ?? []);
function cancel(): void { dialog.value = false; reset(); }
function stage(): void {
  error.value = ""; errors.value = {};
  try {
    if (!selected.value || store.readOnlyReason) throw new Error(store.readOnlyReason || "Configuration unavailable");
    const candidate = cloneConfig(selected.value);
    if (enabled.value) {
      const settings = record(JSON.parse(JSON.stringify(form.value)));
      for (const ingress of Array.isArray(settings.interfaces) ? settings.interfaces : []) {
        const rules = record(ingress).rules;
        for (const rule of Array.isArray(rules) ? rules : []) {
          const entry = record(rule);
          if (Array.isArray(entry.destination_ports)) entry.destination_ports = entry.destination_ports.map(port => typeof port === "string" && /^\d+$/.test(port) ? Number(port) : port);
        }
      }
      candidate.firewall.input = inputFirewallSchema.parse(settings);
    } else delete candidate.firewall.input;
    const issues = validateConfig(candidate, store.runtime.data?.parent_interfaces, store.state.data?.desired).filter(issue => issue.path.startsWith("firewall.input"));
    for (const issue of issues) errors.value[issue.path.replace("firewall.input", "editor")] = [issue.message];
    if (issues.length) throw new Error(issues.map(issue => issue.message).join("; "));
    store.stage(candidate); cancel();
  } catch (failure) {
    if (failure instanceof ZodError) {
      for (const issue of failure.issues) errors.value[`editor.${issue.path.join(".")}`] = [issue.message];
      error.value = failure.issues.map(issue => issue.message).join("; ");
    } else error.value = failure instanceof Error ? failure.message : "Unable to stage input policy";
  }
}
</script>

<template>
  <section aria-label="Host input">
    <v-alert
      v-if="store.readOnlyNotice"
      type="warning"
      class="mb-4"
    >
      {{ store.readOnlyNotice }}
    </v-alert>
    <v-btn
      :prepend-icon="input ? 'mdi-pencil' : 'mdi-plus'"
      :disabled="!selected || Boolean(store.readOnlyReason)"
      class="mb-4"
      @click="reset(); dialog = true"
    >
      {{ input ? "Edit input policy" : "Add input policy" }}
    </v-btn>
    <template v-if="input">
      <p class="mb-3">
        Default: <strong>{{ input.policy }}</strong>
      </p>
      <p class="text-caption text-medium-emphasis mb-4">
        Loopback and established/related traffic are accepted before ingress rules.<span v-if="selected?.firewall.allow_all_icmp"> IPv4 ICMP is accepted first.</span>
      </p>
      <v-table class="input-rules">
        <thead><tr><th>Interface</th><th>Destination</th><th>Protocol</th><th>Ports</th><th>Action</th></tr></thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="`${row.interface}/${row.index}`"
          >
            <td>{{ row.interface }}</td>
            <td>{{ row.rule.destination || "Any" }}</td>
            <td>{{ row.rule.protocol?.toUpperCase() || "Any" }}</td>
            <td>{{ row.rule.destination_ports?.join(", ") || "Any" }}<span v-if="row.rule.protocol === 'udp' && row.rule.destination_ports?.includes(68) && selected?.dhcp_clients?.[row.interface]"> · DHCP client</span></td>
            <td>{{ row.rule.action }}</td>
          </tr>
          <tr v-if="!rows.length">
            <td colspan="5">
              No explicit ingress rules.
            </td>
          </tr>
        </tbody>
      </v-table>
    </template>
    <p
      v-else
      class="text-medium-emphasis"
    >
      No host input filter configured.
    </p>
    <v-dialog
      v-model="dialog"
      max-width="760"
      scrollable
      persistent
    >
      <v-card title="Host input policy">
        <v-card-text>
          <v-switch
            v-model="enabled"
            label="Input filtering"
            hide-details
            color="primary"
            class="mb-4"
          />
          <v-alert
            v-if="input && !enabled"
            type="warning"
            class="mb-4"
          >
            Removing input filtering removes host protection, including WAN protection.
          </v-alert>
          <FieldInput
            v-for="field in enabled ? fields : []"
            :key="field.key"
            :field="field"
            :model-value="form[field.key]"
            :path="`editor.${field.key}`"
            :errors="errors"
            @update:model-value="form = { ...form, [field.key]: $event }"
          />
          <v-alert
            v-if="error"
            type="error"
            role="alert"
            class="mt-4"
          >
            {{ error }}
          </v-alert>
        </v-card-text>
        <v-card-actions>
          <v-btn @click="cancel">
            Cancel
          </v-btn>
          <v-btn
            color="primary"
            :disabled="Boolean(store.readOnlyReason)"
            @click="stage"
          >
            Save
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
.input-rules :deep(table) {
  min-width: 640px;
}

.input-rules :deep(th),
.input-rules :deep(td) {
  white-space: nowrap;
  overflow-wrap: normal;
  word-break: normal;
}
</style>