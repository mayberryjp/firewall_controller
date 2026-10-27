<script setup lang="ts">
import { formatTimestamp } from "@/services/timestamps";
import { computed, onUnmounted, ref, watch, toRef } from "vue";
import { ZodError } from "zod";
import { useControllerStore } from "@/stores/controller";
import { ntpSchema, syslogSchema, vnstatSchema, isApplianceStatus, type ApplianceService } from "@/types/domain";
import { record, type Field } from "@/types/forms";
import { cloneConfig, stableJson, validateConfig } from "@/services/configuration";
import FieldInput from "@/components/base/FieldInput.vue";
import DatasetStatus from "@/components/base/DatasetStatus.vue";
import ServiceWorkerStatus from "@/components/feature/ServiceWorkerStatus.vue";
const props = defineProps<{ service: ApplianceService }>();
const store = useControllerStore();
const service = toRef(props, "service");
const titles = { ntp: "NTP", syslog: "Syslog", vnstat: "Dual-scope vnStat" };
const stored = computed(() => store.activeTransactions.find(item => item.status === "pending_confirmation")?.candidate ?? store.state.data?.desired);
const editing = computed(() => store.draft ?? stored.value);
const form = ref<Record<string, unknown>>({}), initial = ref(""), error = ref(""), errors = ref<Record<string, string[]>>({});
const fields = computed<Field[]>(() => [
  { key: "enabled", label: "Desired enabled", kind: "switch" },
  ...(service.value === "ntp" ? [{ key: "servers", label: "NTP server hosts", kind: "lines" as const, hint: "One canonical IP or lowercase ASCII DNS host per line; 1..8 when enabled, 0..8 disabled. Lists remain validated and retained." }] : []),
  ...(service.value === "syslog" ? [{
    key: "servers", label: "Syslog destinations", kind: "rows" as const,
    create: () => ({ host: "", port: "", transport: "" }),
    fields: [
      { key: "host", label: "Syslog host", kind: "text" as const, hint: "Canonical unicast/loopback IP or lowercase ASCII DNS; no URI, embedded port, zone or trailing dot." },
      { key: "port", label: "Explicit syslog port", kind: "number" as const, hint: "1..65535, no default port" },
      { key: "transport", label: "Explicit transport", kind: "select" as const, choices: ["udp", "tcp", "tls"].map(value => ({ title: value.toUpperCase(), value })) },
    ],
  }] : []),
]);
function reset(): void {
  form.value = record(JSON.parse(JSON.stringify(editing.value?.[service.value] ?? { enabled: false, ...(service.value === "vnstat" ? {} : { servers: [] }) })));
  initial.value = stableJson(form.value); store.editorDirty = false; error.value = ""; errors.value = {};
}
watch(service, reset, { immediate: true });
watch(editing, () => { if (!store.editorDirty) reset(); });
watch(form, () => { store.editorDirty = stableJson(form.value) !== initial.value; }, { deep: true });
onUnmounted(() => { store.editorDirty = false; });
function stage(): void {
  error.value = ""; errors.value = {};
  try {
    if (!editing.value) throw new Error("Committed desired configuration unavailable");
    const candidate = cloneConfig(editing.value);
    if (service.value === "ntp") candidate.ntp = ntpSchema.parse(form.value);
    else if (service.value === "syslog") candidate.syslog = syslogSchema.parse(form.value);
    else candidate.vnstat = vnstatSchema.parse(form.value);
    const issues = validateConfig(candidate).filter(issue => issue.path.startsWith(`${service.value}.`));
    for (const issue of issues) {
      const path = issue.path.replace(service.value, "editor").replace(/\.servers\.\d+$/, ".servers");
      errors.value[path] = [...(errors.value[path] ?? []), issue.message];
    }
    if (issues.length) throw new Error(issues.map(issue => `${issue.path}: ${issue.message}`).join("; "));
    store.stage(candidate); initial.value = stableJson(form.value); store.editorDirty = false;
  } catch (failure) {
    if (failure instanceof ZodError) for (const issue of failure.issues) errors.value[`editor.${issue.path.join(".")}`] = [issue.message];
    error.value = failure instanceof Error ? failure.message : "Unable to stage service";
  }
}
const statusNames = computed(() => service.value === "vnstat" ? ["vnstat-host", "vnstat-managed"] : [service.value]);
const statusRows = computed(() => statusNames.value.map(name => ({
  name, status: store.runtime.data?.appliance_services.filter(isApplianceStatus).find(item => item.name === name),
})));
const hasRuntimeErrors = computed(() => statusRows.value.some(row => row.status?.error));
</script>
<template>
  <section :aria-label="titles[service]">
    <DatasetStatus
      :query="store.state"
      label="Committed desired configuration"
    />
    <DatasetStatus
      :query="store.runtime"
      label="Appliance service runtime"
    />
    <v-alert
      v-if="store.readOnlyNotice"
      type="warning"
      class="mb-4"
    >
      {{ store.readOnlyNotice }}
    </v-alert>
    <v-table class="mb-5">
      <thead>
        <tr>
          <th>Instance</th><th>Scope</th><th>Status</th><th>PID</th><th v-if="service === 'vnstat'">
            Database
          </th><th v-if="hasRuntimeErrors">
            Error
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="{ name, status } in statusRows"
          :key="name"
        >
          <td>{{ name }}</td>
          <td>{{ status?.scope ?? "Unknown" }}</td>
          <td><ServiceWorkerStatus :status="status" /></td>
          <td :title="status?.started_at ? `Started ${formatTimestamp(status.started_at)} UTC` : undefined">
            {{ status?.pid ?? "—" }}
          </td>
          <td
            v-if="service === 'vnstat'"
            class="mono"
          >
            {{ status?.database_directory ?? "Unavailable" }}
          </td>
          <td
            v-if="hasRuntimeErrors"
            role="status"
          >
            {{ status?.error ?? "—" }}
          </td>
        </tr>
      </tbody>
    </v-table>
    <v-alert
      v-if="error"
      type="error"
      role="alert"
      class="mb-4"
    >
      {{ error }}
    </v-alert>
    <FieldInput
      v-for="field in fields"
      :key="field.key"
      :field="{ ...field, disabled: Boolean(store.readOnlyReason) }"
      :model-value="form[field.key]"
      :path="`editor.${field.key}`"
      :errors="errors"
      @update:model-value="form = { ...form, [field.key]: $event }"
    />
    <div class="d-flex flex-wrap ga-3 my-4">
      <v-btn
        color="primary"
        :disabled="Boolean(store.readOnlyReason)"
        @click="stage"
      >
        Save
      </v-btn>
      <v-btn
        :disabled="!store.editorDirty"
        @click="reset"
      >
        Discard unstaged input
      </v-btn>
      <v-btn
        to="/config/changes"
        variant="text"
      >
        SAVE
      </v-btn>
    </div>
  </section>
</template>
