<script setup lang="ts">
import { computed, ref } from "vue";
import type { Section } from "@/services/resourceForms";
import { resourceItems, resourceTitles } from "@/services/resourceCollections";
import { useControllerStore } from "@/stores/controller";
import { useResourceEditor } from "@/composables/useResourceEditor";
import { useResourceCollection } from "@/composables/useResourceCollection";
import ResourceFilters from "@/components/feature/ResourceFilters.vue";
import ResourceTable from "@/components/feature/ResourceTable.vue";
import ResourceRuntime from "@/components/feature/ResourceRuntime.vue";
import ResourceEditorDialog from "@/components/feature/ResourceEditorDialog.vue";
import ResourceDeleteDialog from "@/components/feature/ResourceDeleteDialog.vue";
import FirewallPolicySettings from "@/components/feature/FirewallPolicySettings.vue";
import InterfaceInventory from "@/components/feature/InterfaceInventory.vue";

const props = withDefaults(defineProps<{ section: Section; wireguard?: boolean; name?: string }>(), { wireguard: false, name: undefined });
const store = useControllerStore();
const {
  dialog, form, editingIndex, renameAcknowledged, errors, formError, deletion,
  editingBlocked, allManaged, fields, relaySelection, impacts, renaming, renameImpacts,
  open, manage, change, cancel, stageForm, stageDelete, move,
} = useResourceEditor(props.section, props.wireguard);
const { filters, selectedConfig, rows } = useResourceCollection(props.section, props.wireguard, props.name);
const showFilters = computed(() => !props.name && ((selectedConfig.value && resourceItems(selectedConfig.value, props.section).length > 20) ||
  Object.values(filters).some(value => value !== "" && value !== "All")));
const inventory = ref<InstanceType<typeof InterfaceInventory> | null>(null);
async function refreshInterfaces(): Promise<void> {
  await Promise.all([store.refresh(), inventory.value?.refresh()]);
}
</script>

<template>
  <section :aria-label="`${wireguard ? 'WireGuard' : resourceTitles[section]}${name ? ` · ${name}` : ''}`">
    <h1
      v-if="name"
      class="text-h6 mb-4"
    >
      {{ name }}
    </h1>
    <v-progress-linear
      v-if="store.state.loading && !store.state.data"
      indeterminate
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
        prepend-icon="mdi-plus"
        color="primary"
        :disabled="editingBlocked"
        @click="open()"
      >
        Add {{ section === "interfaces" ? "interface" : section === "softflowd" ? "instance" : section === "gateway_monitors" ? "monitor" : "rule / route" }}
      </v-btn>
      <v-btn
        v-if="section === 'interfaces' && !wireguard && !name"
        icon="mdi-refresh"
        variant="text"
        aria-label="Refresh interfaces"
        title="Refresh interfaces"
        :loading="store.state.loading"
        :disabled="store.busy"
        @click="refreshInterfaces"
      />
    </div>
    <ResourceFilters
      v-if="section !== 'interfaces' && showFilters"
      :model-value="filters"
      :section="section"
      :interfaces="allManaged"
    />
    <ResourceRuntime
      v-if="section !== 'interfaces'"
      :section="section"
    />
    <FirewallPolicySettings
      v-if="section === 'firewall'"
      :selected-config="selectedConfig"
      :show-draft="Boolean(store.draft)"
      @error="formError = $event"
    />
    <ResourceTable
      v-if="selectedConfig"
      :section="section"
      :rows="rows"
      :total="resourceItems(selectedConfig, section).length"
      :disabled="editingBlocked"
      :detail="Boolean(name)"
      @edit="open"
      @delete="deletion = $event"
      @move="move"
    >
      <template #additional-rows="{ columns }">
        <InterfaceInventory
          v-if="section === 'interfaces' && !wireguard && !name"
          ref="inventory"
          :columns="columns"
          @manage="manage"
        />
      </template>
    </ResourceTable>
    <ResourceEditorDialog
      v-model:acknowledged="renameAcknowledged"
      :open="dialog"
      :section="section"
      :title="resourceTitles[section]"
      :editing-index="editingIndex"
      :form="form"
      :fields="fields"
      :errors="errors"
      :error="formError"
      :renaming="renaming"
      :rename-impacts="renameImpacts"
      :relay-selection="relaySelection"
      :disabled="Boolean(store.readOnlyReason)"
      @change="change"
      @cancel="cancel"
      @stage="stageForm"
    />
    <ResourceDeleteDialog
      :deletion="deletion"
      :impacts="impacts"
      @cancel="deletion = null"
      @stage="stageDelete"
    />
  </section>
</template>