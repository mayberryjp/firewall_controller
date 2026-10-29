<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { ZodError } from "zod";
import { useControllerStore } from "@/stores/controller";
import { destinationRewriteSchema, type DestinationRewrite } from "@/types/domain";
import { cloneConfig, numericAddress, stableJson, validateConfig } from "@/services/configuration";
import { interfaceChoice } from "@/services/resourceCollections";

const store = useControllerStore();
const selected = computed(() => store.draft ?? store.state.data?.desired);
const rows = computed(() => selected.value?.firewall.nat.destination_rewrite ?? []);
const editing = ref<number | null>(null), error = ref(""), initial = ref(""), snapshot = ref("");
const form = ref<DestinationRewrite>({ out_interface: "", protocol: "tcp", destination_port: 53, target_interface: "", target_address: "" });
const supported = computed(() => store.state.data?.desired.firewall.nat.destination_rewrite !== undefined);
const blocked = computed(() => Boolean(store.readOnlyReason) || !selected.value || !supported.value);
const family = computed(() => { try { return numericAddress(form.value.target_address).kind(); } catch { return undefined; } });
const wanChoices = computed(() => selected.value?.interfaces.filter(link => link.up && link.role === "wan" &&
  (!family.value || family.value === "ipv4" && selected.value?.dhcp_clients?.[link.name] ||
    link.addresses.some(address => address.includes(":") === (family.value === "ipv6")))).map(interfaceChoice) ?? []);
const targetChoices = computed(() => selected.value?.interfaces.filter(link => link.up && link.role === "lan" &&
  link.addresses.some(address => !family.value || address.includes(":") === (family.value === "ipv6"))).map(interfaceChoice) ?? []);
const input = () => stableJson(form.value);
watch(input, () => { store.editorDirty = editing.value !== null && input() !== initial.value; }, { flush: "sync" });
onUnmounted(() => { store.editorDirty = false; });
function open(index: number): void {
  error.value = ""; editing.value = index;
  const row = rows.value[index];
  form.value = row ? { ...row } : { out_interface: "", protocol: "tcp", destination_port: 53, target_interface: "", target_address: "" };
  initial.value = input(); snapshot.value = stableJson(rows.value); store.editorDirty = false;
}
function close(): void { editing.value = null; store.editorDirty = false; }
function commit(values: DestinationRewrite[]): void {
  if (blocked.value || !selected.value) throw new Error(store.readOnlyReason || "Committed configuration is unavailable");
  const candidate = cloneConfig(selected.value);
  candidate.firewall.nat.destination_rewrite = values;
  const issues = validateConfig(candidate).filter(issue => issue.path.startsWith("firewall.nat.destination_rewrite"));
  if (issues.length) throw new Error(issues.map(issue => issue.message).join(". "));
  store.stage(candidate);
}
function save(): void {
  error.value = "";
  try {
    if (snapshot.value !== stableJson(rows.value)) throw new Error("Rules changed. Cancel and reopen the editor.");
    const rule = destinationRewriteSchema.parse(form.value);
    const values = [...rows.value];
    if (editing.value === -1) values.push(rule);
    else if (editing.value !== null) values[editing.value] = rule;
    else return;
    commit(values); close();
  } catch (failure) { error.value = failure instanceof ZodError ? failure.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join(". ") : failure instanceof Error ? failure.message : "Unable to stage DNAT rule"; }
}
function remove(index: number): void {
  error.value = "";
  try { commit(rows.value.filter((_, position) => position !== index)); }
  catch (failure) { error.value = failure instanceof Error ? failure.message : "Unable to remove DNAT rule"; }
}
function move(index: number, offset: number): void {
  error.value = "";
  try {
    const values = [...rows.value], row = values.splice(index, 1)[0];
    if (!row) throw new Error("Rule is no longer available");
    values.splice(index + offset, 0, row); commit(values);
  } catch (failure) { error.value = failure instanceof Error ? failure.message : "Unable to reorder DNAT rules"; }
}
</script>

<template>
  <section aria-label="DNAT">
    <p
      v-if="store.state.data && !supported"
      role="alert"
      class="text-warning mb-3"
    >
      Deploy a backend with destination rewrite support before editing DNAT.
    </p>
    <v-btn
      class="mb-5"
      prepend-icon="mdi-plus"
      color="primary"
      :disabled="blocked || editing !== null"
      @click="open(-1)"
    >
      Add DNAT rule
    </v-btn>
    <p
      v-if="error"
      role="alert"
      class="text-error mb-3"
    >
      {{ error }}
    </p>
    <v-table class="inline-table">
      <thead><tr><th>WAN</th><th>Protocol</th><th>Port</th><th>Target interface</th><th>Target address</th><th>Actions</th></tr></thead>
      <tbody>
        <template
          v-for="(row, index) in [...rows, ...(editing === -1 ? [null] : [])]"
          :key="index"
        >
          <tr v-if="editing === index || editing === -1 && index === rows.length">
            <td>
              <v-select
                v-model="form.out_interface"
                :items="wanChoices"
                label="WAN"
                density="compact"
                hide-details
                :disabled="blocked"
              />
            </td>
            <td>
              <v-select
                v-model="form.protocol"
                :items="['tcp', 'udp']"
                label="Protocol"
                density="compact"
                hide-details
                :disabled="blocked"
              />
            </td>
            <td>
              <v-text-field
                v-model.number="form.destination_port"
                label="Port"
                type="number"
                min="1"
                max="65535"
                density="compact"
                hide-details
                :disabled="blocked"
              />
            </td>
            <td>
              <v-select
                v-model="form.target_interface"
                :items="targetChoices"
                label="Target interface"
                density="compact"
                hide-details
                :disabled="blocked"
              />
            </td>
            <td>
              <v-text-field
                v-model="form.target_address"
                label="Target address"
                density="compact"
                hide-details
                :disabled="blocked"
                @keydown.enter.prevent="save"
              />
            </td>
            <td>
              <v-btn
                size="small"
                color="primary"
                :disabled="blocked"
                @click="save"
              >
                Save
              </v-btn><v-btn
                size="small"
                variant="text"
                @click="close"
              >
                Cancel
              </v-btn>
            </td>
          </tr>
          <tr v-else-if="row">
            <td>
              <v-chip
                size="small"
                variant="tonal"
                color="info"
              >
                {{ row.out_interface }}
              </v-chip>
            </td>
            <td>
              <v-chip
                size="small"
                variant="tonal"
                color="info"
              >
                {{ row.protocol.toUpperCase() }}
              </v-chip>
            </td>
            <td>{{ row.destination_port }}</td><td>{{ row.target_interface }}</td><td :title="row.metadata?.description">
              {{ row.metadata?.display_name ? `${row.metadata.display_name} (${row.target_address})` : row.target_address }}
            </td>
            <td class="actions">
              <v-btn
                icon="mdi-pencil-outline"
                size="x-small"
                variant="text"
                :aria-label="`Edit DNAT rule ${index + 1}`"
                :disabled="blocked || editing !== null"
                @click="open(index)"
              />
              <v-btn
                icon="mdi-delete-outline"
                size="x-small"
                variant="text"
                color="error"
                :aria-label="`Delete DNAT rule ${index + 1}`"
                :disabled="blocked || editing !== null"
                @click="remove(index)"
              />
              <v-btn
                icon="mdi-arrow-up"
                size="x-small"
                variant="text"
                :aria-label="`Move DNAT rule ${index + 1} up`"
                :disabled="blocked || editing !== null || index === 0"
                @click="move(index, -1)"
              />
              <v-btn
                icon="mdi-arrow-down"
                size="x-small"
                variant="text"
                :aria-label="`Move DNAT rule ${index + 1} down`"
                :disabled="blocked || editing !== null || index === rows.length - 1"
                @click="move(index, 1)"
              />
            </td>
          </tr>
        </template>
        <tr v-if="!rows.length && editing === null">
          <td colspan="6">
            No DNAT rules.
          </td>
        </tr>
      </tbody>
    </v-table>
  </section>
</template>

<style scoped>
.inline-table :deep(th), .inline-table :deep(td) { padding: 2px 6px; }
.inline-table :deep(.v-input) { min-width: 120px; }
.inline-table :deep(td) { vertical-align: top; }
.actions { white-space: nowrap; }
</style>
