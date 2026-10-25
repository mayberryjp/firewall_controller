<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { useControllerStore } from "@/stores/controller";
import { cloneConfig, validateConfig } from "@/services/configuration";

const store = useControllerStore();
const selected = computed(() => store.draft ?? store.state.data?.desired);
const interfaces = computed(() => selected.value?.interfaces.filter(link => link.role === "lan" || link.role === "wan") ?? []);
const rows = computed(() => [...new Set(interfaces.value.flatMap(link => selected.value?.dns?.[link.name]?.servers ?? []))]);
const editIndex = ref<number | null>(null), server = ref(""), error = ref("");
const original = ref<string | null>(null);
const list = computed(() => editIndex.value === -1 ? [...rows.value, ""] : rows.value);
const blocked = computed(() => Boolean(store.readOnlyReason) || !selected.value || !interfaces.value.length);
const isEditing = (index: number) => editIndex.value === index || (editIndex.value === -1 && index === rows.value.length);

watch(server, () => { store.editorDirty = editIndex.value !== null && server.value !== (original.value ?? ""); }, { flush: "sync" });
onUnmounted(() => { store.editorDirty = false; });

function open(index: number | null): void {
  error.value = "";
  editIndex.value = index ?? -1;
  original.value = index === null ? null : rows.value[index]!;
  server.value = original.value ?? "";
  store.editorDirty = false;
}
function close(): void {
  editIndex.value = null; error.value = ""; store.editorDirty = false;
}
function commit(addresses: string[]): void {
  if (blocked.value || !selected.value) {
    throw new Error(store.readOnlyReason || "At least one configured LAN or WAN interface is required.");
  }
  const candidate = cloneConfig(selected.value);
  candidate.dns ??= {};
  for (const link of interfaces.value) {
    candidate.dns[link.name] = { ...candidate.dns[link.name], servers: [...addresses], domains: candidate.dns[link.name]?.domains ?? [] };
  }
  const issues = validateConfig(candidate).filter(issue => interfaces.value.some(link =>
    issue.path === `dns.${link.name}` || issue.path.startsWith(`dns.${link.name}.`)));
  if (issues.length) throw new Error([...new Set(issues.map(issue => issue.message))].join(". "));
  store.stage(candidate);
}
function stage(): void {
  error.value = "";
  try {
    const addresses = [...rows.value], address = server.value.trim();
    if (original.value === null) addresses.push(address);
    else {
      const index = addresses.indexOf(original.value);
      if (index < 0) throw new Error("This DNS server has changed. Cancel and reopen the editor.");
      addresses[index] = address;
    }
    commit(addresses);
    close();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Unable to stage remote DNS settings";
  }
}
function remove(address: string): void {
  error.value = "";
  try { commit(rows.value.filter(value => value !== address)); close(); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : "Unable to delete DNS server"; }
}
</script>

<template>
  <section aria-label="Remote DNS">
    <v-alert
      v-if="store.readOnlyNotice"
      type="warning"
      variant="tonal"
      class="mb-4"
    >
      {{ store.readOnlyNotice }}
    </v-alert>
    <v-alert
      v-if="error"
      type="error"
      class="mb-4"
    >
      {{ error }}
    </v-alert>
    <v-alert
      v-if="!interfaces.length"
      type="info"
      variant="tonal"
      class="mb-4"
    >
      Configure an interface with the LAN or WAN role before setting remote DNS servers.
    </v-alert>
    <div class="d-flex flex-wrap align-center ga-3 mb-5">
      <v-btn
        prepend-icon="mdi-plus"
        color="primary"
        :disabled="blocked"
        @click="open(null)"
      >
        Add DNS server
      </v-btn>
    </div>
    <v-table class="service-table">
      <thead>
        <tr>
          <th scope="col">
            Server
          </th>
          <th scope="col">
            Actions
          </th>
        </tr>
      </thead>
      <tbody>
        <template
          v-for="(address, index) in list"
          :key="`${index}/${address}`"
        >
          <tr v-if="!isEditing(index)">
            <td>{{ address }}</td>
            <td class="column-actions">
              <v-btn
                icon="mdi-pencil-outline"
                :aria-label="`Edit ${address}`"
                :title="`Edit ${address}`"
                size="x-small"
                variant="text"
                :disabled="blocked"
                @click="open(index)"
              />
              <v-btn
                icon="mdi-delete-outline"
                :aria-label="`Delete ${address}`"
                :title="`Delete ${address}`"
                size="x-small"
                variant="text"
                color="error"
                :disabled="blocked"
                @click="remove(address)"
              />
            </td>
          </tr>
          <tr v-else>
            <td>
              <v-text-field
                v-model="server"
                aria-label="DNS server"
                placeholder="IP address"
                density="compact"
                hide-details
                autofocus
                :disabled="blocked"
                @keydown.enter.prevent="stage"
              />
            </td>
            <td class="column-actions">
              <v-btn
                color="primary"
                size="small"
                :disabled="blocked"
                @click="stage"
              >
                Save
              </v-btn>
              <v-btn
                variant="text"
                size="small"
                @click="close"
              >
                Cancel
              </v-btn>
            </td>
          </tr>
        </template>
        <tr v-if="!rows.length && editIndex === null">
          <td colspan="2">
            No servers.
          </td>
        </tr>
      </tbody>
    </v-table>
  </section>
</template>

<style scoped>
section { padding-bottom: 56px; }
.service-table :deep(th), .service-table :deep(td) { white-space: normal; overflow-wrap: anywhere; }
.service-table :deep(.column-actions) { width: 140px; }
</style>
