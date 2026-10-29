<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { useControllerStore } from "@/stores/controller";
import { cloneConfig, stableJson, validateConfig } from "@/services/configuration";
import { eligibleMDNSInterface, mdnsInterfaces, normalizeMDNS } from "@/services/mdns";
import { mdnsSchema, type MDNSConfig } from "@/types/domain";
import DatasetStatus from "@/components/base/DatasetStatus.vue";

const store = useControllerStore();
const stored = computed(() => store.activeTransactions.find(item => item.status === "pending_confirmation")?.candidate ?? store.state.data?.desired);
const editing = computed(() => store.draft ?? stored.value);
const form = ref<MDNSConfig>(mdnsSchema.parse({})), initial = ref(""), error = ref("");
const sourceSettings = ref("");
const snapshot = () => stableJson(form.value);
function reset(): void {
  form.value = mdnsSchema.parse(editing.value?.mdns ?? {});
  sourceSettings.value = stableJson(editing.value?.mdns);
  if (editing.value && form.value.interface_mode === "deny") form.value.interfaces = mdnsInterfaces(editing.value, form.value);
  form.value.interface_mode = "allow";
  initial.value = snapshot(); store.editorDirty = false; error.value = "";
}
watch(editing, () => { if (!store.editorDirty) reset(); }, { immediate: true });
watch(form, () => { store.editorDirty = snapshot() !== initial.value; }, { deep: true, flush: "sync" });
onUnmounted(() => { store.editorDirty = false; });
const blocked = computed(() => Boolean(store.readOnlyReason) || !editing.value);
const choices = computed(() => (editing.value?.interfaces ?? [])
  .filter(link => eligibleMDNSInterface(editing.value!, link))
  .map(link => link.name));
function stage(): void {
  error.value = "";
  try {
    if (blocked.value || !editing.value) throw new Error(store.readOnlyReason || "Committed configuration is unavailable.");
    if (stableJson(editing.value.mdns) !== sourceSettings.value) throw new Error("mDNS settings changed while editing. Cancel edits to load current settings before staging.");
    const candidate = cloneConfig(editing.value);
    const filters = form.value.reflection.filters.map(value => value.trim()).filter(Boolean).map(value => {
      const name = value.replace(/\.$/, "");
      return /(?:^|\.)local$/i.test(name) ? `${name}.` : `${name}.local.`;
    });
    candidate.mdns = mdnsSchema.parse({
      ...form.value,
      enabled: filters.length > 0,
      interface_mode: "allow",
      ipv4: true,
      ipv6: candidate.ipv6_enabled !== false,
      reflection: { enabled: true, filters },
      publishing: { ...form.value.publishing, enabled: false, a_on_ipv6: candidate.ipv6_enabled !== false && form.value.publishing.a_on_ipv6 },
    });
    normalizeMDNS(candidate.mdns);
    const issues = validateConfig(candidate).filter(issue => issue.path.startsWith("mdns."));
    if (issues.length) throw new Error(issues.map(issue => issue.message).join(" "));
    store.stage(candidate);
    reset();
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "Unable to stage mDNS settings."; }
}
</script>

<template>
  <section aria-label="mDNS / Discovery">
    <DatasetStatus
      :query="store.state"
      label="Committed configuration"
    />
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
      role="alert"
    >
      {{ error }}
    </v-alert>
    <v-form
      :disabled="blocked"
      @submit.prevent="stage"
    >
      <v-select
        v-model="form.interfaces"
        :items="choices"
        label="LAN links"
        multiple
        chips
        closable-chips
        hide-details
        class="mb-4"
      />
      <div
        v-for="(_, index) in form.reflection.filters"
        :key="index"
        class="d-flex align-center ga-3 mb-3"
      >
        <v-text-field
          v-model="form.reflection.filters[index]"
          :label="`Service ${index + 1}`"
          hide-details
        />
        <v-btn
          icon="mdi-delete"
          :aria-label="`Delete service ${index + 1}`"
          :title="`Delete service ${index + 1}`"
          variant="text"
          :disabled="blocked"
          @click="form.reflection.filters.splice(index, 1)"
        />
      </div>
      <div class="d-flex flex-wrap ga-3 mt-4">
        <v-btn
          prepend-icon="mdi-plus"
          color="primary"
          :disabled="blocked || form.reflection.filters.length >= 64"
          @click="form.reflection.filters.push('')"
        >
          Add service
        </v-btn>
        <v-btn
          type="submit"
          prepend-icon="mdi-check"
          color="primary"
          :disabled="blocked"
        >
          Stage changes
        </v-btn>
        <v-btn
          prepend-icon="mdi-close"
          :disabled="blocked || !store.editorDirty"
          @click="reset"
        >
          Cancel edits
        </v-btn>
      </div>
    </v-form>
  </section>
</template>
