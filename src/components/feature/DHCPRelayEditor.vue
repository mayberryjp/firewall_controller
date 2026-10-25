<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { useControllerStore } from "@/stores/controller";
import { cloneConfig, selectedRelayPrefix, stableJson, validateConfig } from "@/services/configuration";
import type { Field } from "@/types/forms";
import FieldInput from "@/components/base/FieldInput.vue";
import { dhcpRelaySchema } from "@/types/domain";
import { metadataFields } from "@/services/resourceForms";

const target = defineModel<string | null>({ required: true });
const store = useControllerStore();
const selected = computed(() => store.draft ?? store.state.data?.active_transaction?.candidate ?? store.state.data?.desired);
const link = computed(() => selected.value?.interfaces.find(item => item.name === target.value));
const form = ref<Record<string, unknown>>({}), initial = ref(""), error = ref("");
const errors = ref<Record<string, string[]>>({});
const fields: Field[] = metadataFields([
  { key: "enabled", label: "Enable DHCPv4 relay", kind: "switch" },
  { key: "servers", label: "DHCPv4 relay servers", kind: "lines", hint: "One unicast IPv4 address per line. Every server receives requests." },
]);
const address = computed(() => {
  try { return link.value ? selectedRelayPrefix(link.value) ?? "No eligible IPv4 prefix" : "Interface unavailable"; }
  catch (failure) { return failure instanceof Error ? failure.message : "Invalid interface address"; }
});
watch(target, () => {
  form.value = JSON.parse(JSON.stringify(link.value?.dhcp_relay ?? { enabled: false, servers: [] }));
  initial.value = stableJson(form.value); error.value = ""; errors.value = {}; store.editorDirty = false;
}, { immediate: true });
watch(form, () => { if (target.value) store.editorDirty = stableJson(form.value) !== initial.value; }, { deep: true });
onUnmounted(() => { store.editorDirty = false; });
function cancel(): void {
  if (store.editorDirty && !window.confirm("Discard unstaged form input?")) return;
  target.value = null; store.editorDirty = false;
}
function stage(): void {
  error.value = ""; errors.value = {};
  try {
    if (!selected.value || store.readOnlyReason) throw new Error(store.readOnlyReason || "Configuration unavailable");
    const candidate = cloneConfig(selected.value), index = candidate.interfaces.findIndex(item => item.name === target.value);
    const entry = candidate.interfaces[index];
    if (!entry || entry.kind === "wireguard") throw new Error("Select an Ethernet, loopback or VLAN interface");
    entry.dhcp_relay = dhcpRelaySchema.parse(form.value);
    const base = `interfaces.${index}.dhcp_relay`;
    const issues = validateConfig(candidate).filter(issue => issue.path === base || issue.path.startsWith(`${base}.`) || issue.path === `dhcp_clients.${entry.name}`);
    for (const issue of issues) errors.value[issue.path.replace(base, "relay").replace(/\.servers\.\d+$/, ".servers")] = [issue.message];
    if (issues.length) throw new Error(issues.map(issue => issue.message).join("; "));
    store.stage(candidate); target.value = null; store.editorDirty = false;
  } catch (failure) { error.value = failure instanceof Error ? failure.message : "Unable to stage DHCP relay"; }
}
</script>

<template>
  <v-dialog
    :model-value="target !== null"
    max-width="620"
    persistent
    scrollable
  >
    <v-card :title="`DHCPv4 relay · ${target ?? ''}`">
      <v-card-text>
        <FieldInput
          v-for="field in fields"
          :key="field.key"
          :field="{ ...field, disabled: Boolean(store.readOnlyReason) }"
          :model-value="form[field.key]"
          :path="`relay.${field.key}`"
          :errors="errors"
          @update:model-value="form = { ...form, [field.key]: $event }"
        />
        <p class="my-3">
          Relay address: {{ address }}
        </p>
        <v-alert
          type="warning"
          variant="tonal"
          class="my-3"
        >
          Changes can restart the shared relay process and briefly disrupt other interfaces. DHCP relay requires static IPv4 and cannot share an interface with a DHCP client.
        </v-alert>
        <v-alert
          v-if="error"
          type="error"
          role="alert"
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
</template>