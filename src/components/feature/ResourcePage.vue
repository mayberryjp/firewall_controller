<script setup lang="ts">
import { computed } from "vue";
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
import PhysicalInterfaceEditor from "@/components/feature/PhysicalInterfaceEditor.vue";
import InterfaceRowEditor from "@/components/feature/InterfaceRowEditor.vue";
import ResourceRowEditor from "@/components/feature/ResourceRowEditor.vue";
import { cloneConfig, stableJson } from "@/services/configuration";
import type { DiscoveredInterface } from "@/types/domain";

const props = withDefaults(defineProps<{ section: Section; wireguard?: boolean; vlan?: boolean; loopbacks?: boolean; name?: string }>(), { wireguard: false, vlan: false, loopbacks: false, name: undefined });
const store = useControllerStore();
const inlineResource = computed(() => ["routes", "gateway_monitors", "nat", "softflowd"].includes(props.section));
const inlineResourceTitle = computed(() => props.section === "routes" ? "Route" : props.section === "nat" ? "Masquerade" : props.section === "softflowd" ? "Export" : "Gateway monitor");
const collapsibleOptions = computed(() => ["gateway_monitors", "softflowd"].includes(props.section));
const inlineEditor = computed(() => props.vlan || props.loopbacks || inlineResource.value);
const {
  dialog, form, editingIndex, renameAcknowledged, errors, formError, deletion,
  editingBlocked, interfaceOptions, fields, impacts, renaming, renameImpacts,
  open, manage, change, cancel, stageForm, stageDelete, move,
} = useResourceEditor(props.section, props.wireguard, props.vlan, props.loopbacks);
const { filters, selectedConfig, rows } = useResourceCollection(props.section, props.wireguard, props.name, props.vlan);
const showFilters = computed(() => !props.name && ((selectedConfig.value && resourceItems(selectedConfig.value, props.section).length > 20) ||
  Object.values(filters).some(value => value !== "" && value !== "All")));
const showInventory = computed(() => props.section === "interfaces" && !props.wireguard && !props.vlan && !props.name);
function editInterface(value: unknown): void {
  if (dialog.value && (form.value.kind === "ethernet" || inlineEditor.value)) {
    const same = inlineResource.value ? editingIndex.value >= 0 && stableJson(value) === stableJson(rows.value.find(row => row.index === editingIndex.value)?.value) :
      typeof value === "object" && value !== null && "name" in value && value.name === form.value.name;
    cancel();
    if (dialog.value || same) return;
  }
  open(value);
}
function addResource(): void {
  if (dialog.value && inlineEditor.value) { cancel(); if (dialog.value) return; }
  open();
}
function toggleMonitor(value: unknown, enabled: boolean): void {
  if (editingBlocked.value) return;
  if (dialog.value) { cancel(); if (dialog.value) return; }
  if (props.section === "routes" || props.section === "softflowd") {
    if (!selectedConfig.value) return;
    const candidate = cloneConfig(selectedConfig.value);
    const items: Array<{ enabled?: boolean }> = props.section === "routes" ? candidate.routes : candidate.softflowd;
    const item = items.find(entry => stableJson(entry) === stableJson(value));
    if (!item) return;
    item.enabled = enabled;
    store.stage(candidate);
    return;
  }
  open(value);
  change("enabled", enabled);
  stageForm();
}
function manageInterface(link: DiscoveredInterface): void {
  if (dialog.value) { cancel(); if (dialog.value) return; }
  manage(link);
}
function deleteResource(row: { index: number; value: unknown }): void {
  if (dialog.value && (form.value.kind === "ethernet" || inlineEditor.value)) { cancel(); if (dialog.value) return; }
  deletion.value = row;
}
function moveResource(index: number, delta: number): void {
  if (props.section === "nat" && dialog.value) cancel();
  move(index, delta);
}
</script>

<template>
  <section :aria-label="`${loopbacks ? 'Loopbacks' : vlan ? 'VLANs' : wireguard ? 'WireGuard' : resourceTitles[section]}${name ? ` · ${name}` : ''}`">
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
      v-if="store.readOnlyNotice"
      type="warning"
      variant="tonal"
      class="mb-4"
    >
      {{ store.readOnlyNotice }}
    </v-alert>
    <v-alert
      v-if="formError && !dialog"
      type="error"
      class="mb-4"
    >
      {{ formError }}
    </v-alert>
    <div
      v-if="section !== 'interfaces' || wireguard || vlan || loopbacks"
      class="d-flex flex-wrap align-center ga-3 mb-5"
    >
      <v-btn
        prepend-icon="mdi-plus"
        color="primary"
        :disabled="editingBlocked"
        @click="addResource"
      >
        Add {{ loopbacks ? "loopback" : vlan ? "VLAN" : wireguard ? "tunnel" : section === "softflowd" ? "export" : section === "gateway_monitors" ? "monitor" : section === "routes" ? "Static Route" : "rule" }}
      </v-btn>
    </div>
    <ResourceFilters
      v-if="section !== 'interfaces' && showFilters"
      :model-value="filters"
      :section="section"
      :interfaces="interfaceOptions"
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
    <InterfaceInventory
      v-if="showInventory"
      :loopbacks="loopbacks"
      :editing-row="loopbacks && dialog ? editingIndex : undefined"
      :expanded-name="dialog && form.kind === 'ethernet' ? String(form.name) : undefined"
      @manage="manageInterface"
      @edit="editInterface"
      @delete="deleteResource"
    >
      <template #editing-row="{ row, columns, keys }">
        <PhysicalInterfaceEditor
          v-if="dialog && form.kind === 'ethernet' && row.value.name === form.name"
          :form="form"
          :columns="columns"
          :keys="keys"
          :row="row"
          :errors="errors"
          :error="formError"
          :disabled="Boolean(store.readOnlyReason)"
          @change="change"
          @cancel="cancel"
          @stage="stageForm"
        />
        <InterfaceRowEditor
          v-else-if="loopbacks"
          v-model:acknowledged="renameAcknowledged"
          loopbacks
          :form="form"
          :fields="fields"
          :columns="columns"
          :errors="errors"
          :error="formError"
          :disabled="editingBlocked"
          :renaming="renaming"
          :rename-impacts="renameImpacts"
          @change="change"
          @cancel="cancel"
          @stage="stageForm"
        />
      </template>
      <template #additional-rows="{ columns }">
        <InterfaceRowEditor
          v-if="loopbacks && dialog && editingIndex < 0"
          v-model:acknowledged="renameAcknowledged"
          loopbacks
          :form="form"
          :fields="fields"
          :columns="columns"
          :errors="errors"
          :error="formError"
          :disabled="editingBlocked"
          :renaming="renaming"
          :rename-impacts="renameImpacts"
          @change="change"
          @cancel="cancel"
          @stage="stageForm"
        />
      </template>
    </InterfaceInventory>
    <ResourceTable
      v-else-if="selectedConfig"
      :section="section"
      :rows="rows"
      :total="resourceItems(selectedConfig, section).length"
      :disabled="editingBlocked"
      :detail="Boolean(name)"
      :wireguard="wireguard"
      :vlan="vlan"
      :editing-row="(vlan || inlineResource) && dialog ? editingIndex : undefined"
      :expanded-name="dialog && form.kind === 'ethernet' ? String(form.name) : undefined"
      @edit="editInterface"
      @delete="deleteResource"
      @move="moveResource"
      @toggle="toggleMonitor"
    >
      <template #editing-row="{ row, columns, keys }">
        <PhysicalInterfaceEditor
          v-if="dialog && form.kind === 'ethernet' && row.value.name === form.name"
          :form="form"
          :columns="columns"
          :keys="keys"
          :row="row"
          :errors="errors"
          :error="formError"
          :disabled="Boolean(store.readOnlyReason)"
          @change="change"
          @cancel="cancel"
          @stage="stageForm"
        />
        <InterfaceRowEditor
          v-else-if="vlan"
          v-model:acknowledged="renameAcknowledged"
          :form="form"
          :fields="fields"
          :columns="columns"
          :errors="errors"
          :error="formError"
          :disabled="editingBlocked"
          :renaming="renaming"
          :rename-impacts="renameImpacts"
          @change="change"
          @cancel="cancel"
          @stage="stageForm"
        />
        <ResourceRowEditor
          v-else-if="inlineResource"
          :collapse-options="collapsibleOptions"
          :wide="section === 'softflowd'"
          :title="inlineResourceTitle"
          :position="section === 'nat' ? editingIndex + 1 : undefined"
          :form="form"
          :fields="fields"
          :keys="keys"
          :columns="columns"
          :errors="errors"
          :error="formError"
          :disabled="editingBlocked"
          @change="change"
          @cancel="cancel"
          @stage="stageForm"
        />
      </template>
      <template #additional-rows="{ columns, keys }">
        <InterfaceRowEditor
          v-if="vlan && dialog && editingIndex < 0"
          v-model:acknowledged="renameAcknowledged"
          :form="form"
          :fields="fields"
          :columns="columns"
          :errors="errors"
          :error="formError"
          :disabled="editingBlocked"
          :renaming="renaming"
          :rename-impacts="renameImpacts"
          @change="change"
          @cancel="cancel"
          @stage="stageForm"
        />
        <ResourceRowEditor
          v-if="inlineResource && dialog && editingIndex < 0"
          :collapse-options="collapsibleOptions"
          :wide="section === 'softflowd'"
          :title="inlineResourceTitle"
          :position="section === 'nat' ? resourceItems(selectedConfig, section).length + 1 : undefined"
          :form="form"
          :fields="fields.filter(field => field.key !== 'metadata')"
          :keys="keys"
          :columns="columns"
          :errors="errors"
          :error="formError"
          :disabled="editingBlocked"
          @change="change"
          @cancel="cancel"
          @stage="stageForm"
        />
      </template>
    </ResourceTable>
    <ResourceEditorDialog
      v-if="!inlineEditor && form.kind !== 'ethernet'"
      v-model:acknowledged="renameAcknowledged"
      :open="dialog"
      :section="section"
      :title="loopbacks ? 'Loopback' : vlan ? 'VLAN' : wireguard ? 'WireGuard' : resourceTitles[section]"
      :editing-index="editingIndex"
      :form="form"
      :fields="fields"
      :errors="errors"
      :error="formError"
      :renaming="renaming"
      :rename-impacts="renameImpacts"
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