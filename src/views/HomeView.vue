<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useControllerStore } from "@/stores/controller";
import { getOverviewLayout, saveOverviewLayout } from "@/services/registry";
import { copyOverviewLayout, defaultOverviewLayout, overviewWidgetIds, type OverviewWidgetId } from "@/services/overviewLayout";
import OverviewInterfaces from "@/components/feature/OverviewInterfaces.vue";
import OverviewCounters from "@/components/feature/OverviewCounters.vue";
import OverviewSystem from "@/components/feature/OverviewSystem.vue";
import OverviewGateways from "@/components/feature/OverviewGateways.vue";
import OverviewWireGuard from "@/components/feature/OverviewWireGuard.vue";
import OverviewBGP from "@/components/feature/OverviewBGP.vue";
const store = useControllerStore();
const widgets = {
  interfaces: { title: "Interfaces", component: OverviewInterfaces },
  gateways: { title: "Gateways", component: OverviewGateways },
  wireguard: { title: "WireGuard", component: OverviewWireGuard },
  bgp: { title: "BGP peers", component: OverviewBGP },
  system: { title: "System stats", component: OverviewSystem },
  counters: { title: "Interface counters", component: OverviewCounters },
};
const layout = ref(defaultOverviewLayout()), draft = ref(defaultOverviewLayout());
const loadingLayout = ref(true), layoutLoaded = ref(false), editing = ref(false), saving = ref(false);
const layoutError = ref(""), layoutNotice = ref(""), dragging = ref<OverviewWidgetId | null>(null);
const displayedLayout = computed(() => editing.value ? draft.value : layout.value);
const hiddenWidgets = computed(() => overviewWidgetIds.filter(id => !draft.value.columns.some(column => column.includes(id))));
async function loadLayout() {
  loadingLayout.value = true; layoutError.value = "";
  try {
    layout.value = await getOverviewLayout();
    layoutLoaded.value = true;
  } catch (error) {
    layoutError.value = `Could not load the shared overview layout. ${error instanceof Error ? error.message : String(error)}`;
  } finally { loadingLayout.value = false; }
}
function customize() {
  draft.value = copyOverviewLayout(layout.value);
  editing.value = true; layoutNotice.value = ""; layoutError.value = "";
}
function cancel() {
  editing.value = false; dragging.value = null; layoutError.value = "";
}
async function saveLayout() {
  saving.value = true; layoutError.value = "";
  try {
    layout.value = await saveOverviewLayout(draft.value);
    editing.value = false; dragging.value = null;
    layoutNotice.value = "Overview layout saved to the registry.";
  } catch (error) {
    layoutError.value = `Could not save the overview layout. Your changes are not confirmed saved; retry or cancel. ${error instanceof Error ? error.message : String(error)}`;
  } finally { saving.value = false; }
}
function move(id: OverviewWidgetId, column: number, index: number) {
  if (!editing.value || saving.value) return;
  for (const items of draft.value.columns) {
    const current = items.indexOf(id);
    if (current !== -1) items.splice(current, 1);
  }
  const target = draft.value.columns[column];
  if (target) target.splice(index, 0, id);
}
function hide(id: OverviewWidgetId) {
  if (saving.value) return;
  for (const column of draft.value.columns) {
    const index = column.indexOf(id);
    if (index !== -1) column.splice(index, 1);
  }
}
function startDrag(event: DragEvent, id: OverviewWidgetId) {
  if (saving.value || !event.dataTransfer) { event.preventDefault(); return; }
  dragging.value = id;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", id);
}
function drop(column: number, index: number) {
  const id = dragging.value;
  if (!id) return;
  const sourceIndex = draft.value.columns[column]?.indexOf(id) ?? -1;
  move(id, column, sourceIndex !== -1 && sourceIndex < index ? index - 1 : index);
  dragging.value = null;
}
onMounted(() => {
  void loadLayout();
  store.gatewayMonitoring = true;
  void store.refreshStatistics();
  void store.refreshGatewayStatistics();
});
onUnmounted(() => { store.gatewayMonitoring = false; });
</script>

<template>
  <section aria-label="Overview">
    <div class="overview-heading">
      <v-btn
        v-if="!editing"
        icon="mdi-pencil-outline"
        variant="text"
        size="small"
        aria-label="Customize layout"
        title="Customize layout"
        :disabled="loadingLayout || !layoutLoaded"
        @click="customize"
      />
      <template v-else>
        <v-btn
          color="primary"
          size="small"
          :loading="saving"
          :disabled="saving"
          @click="saveLayout"
        >
          Save layout
        </v-btn>
        <v-btn
          variant="text"
          size="small"
          :disabled="saving"
          @click="cancel"
        >
          Cancel
        </v-btn>
      </template>
    </div>
    <v-alert
      v-if="layoutError"
      type="error"
      variant="tonal"
      class="mb-4"
      role="alert"
    >
      {{ layoutError }}
      <v-btn
        v-if="!layoutLoaded"
        variant="text"
        :disabled="loadingLayout"
        @click="loadLayout"
      >
        Retry layout
      </v-btn>
    </v-alert>
    <p
      v-if="layoutNotice"
      role="status"
      class="text-caption mb-4"
    >
      {{ layoutNotice }}
    </p>
    <div
      v-if="editing"
      class="layout-settings"
    >
      <p>Drag a box using its handle, or use the move buttons. Hidden boxes can be restored below. Changes apply to everyone using this registry after saving.</p>
      <div class="layout-restore">
        <v-btn
          v-for="id in hiddenWidgets"
          :key="id"
          size="small"
          variant="outlined"
          :disabled="saving"
          @click="move(id, 0, draft.columns[0].length)"
        >
          Show {{ widgets[id].title }}
        </v-btn>
        <v-btn
          size="small"
          variant="text"
          :disabled="saving"
          @click="draft = defaultOverviewLayout()"
        >
          Reset layout
        </v-btn>
      </div>
    </div>
    <p v-if="!displayedLayout.columns.flat().length">
      All overview boxes are hidden. Use the Customize layout pencil to show them again.
    </p>
    <div
      class="overview-dashboard"
      :class="{ 'overview-dashboard--editing': editing }"
    >
      <div
        v-for="(column, columnIndex) in displayedLayout.columns"
        :key="columnIndex"
        class="overview-column"
        :data-column="columnIndex"
        @dragover="editing && $event.preventDefault()"
        @drop.prevent="drop(columnIndex, column.length)"
      >
        <p
          v-if="editing"
          class="column-label"
        >
          {{ columnIndex === 0 ? "Left column" : "Right column" }}
        </p>
        <div
          v-for="(id, index) in column"
          :key="id"
          class="overview-box"
          :data-widget="id"
          @dragover="editing && $event.preventDefault()"
          @drop.stop.prevent="drop(columnIndex, index)"
        >
          <div
            v-if="editing"
            class="layout-controls"
            role="group"
            :aria-label="`Arrange ${widgets[id].title}`"
          >
            <button
              type="button"
              class="layout-control layout-drag"
              :draggable="!saving"
              :disabled="saving"
              :aria-label="`Drag ${widgets[id].title}`"
              title="Drag to move this box"
              @dragstart="startDrag($event, id)"
              @dragend="dragging = null"
            >
              <v-icon icon="mdi-drag" />
            </button>
            <span class="layout-box-title">{{ widgets[id].title }}</span>
            <button
              type="button"
              class="layout-control"
              :aria-label="`Move ${widgets[id].title} up`"
              title="Move up"
              :disabled="saving || index === 0"
              @click="move(id, columnIndex, index - 1)"
            >
              <v-icon icon="mdi-arrow-up" />
            </button>
            <button
              type="button"
              class="layout-control"
              :aria-label="`Move ${widgets[id].title} down`"
              title="Move down"
              :disabled="saving || index === column.length - 1"
              @click="move(id, columnIndex, index + 1)"
            >
              <v-icon icon="mdi-arrow-down" />
            </button>
            <button
              type="button"
              class="layout-control"
              :aria-label="`Move ${widgets[id].title} to ${columnIndex === 0 ? 'right' : 'left'} column`"
              :title="`Move to ${columnIndex === 0 ? 'right' : 'left'} column`"
              :disabled="saving"
              @click="move(id, 1 - columnIndex, draft.columns[1 - columnIndex]!.length)"
            >
              <v-icon :icon="columnIndex === 0 ? 'mdi-arrow-right' : 'mdi-arrow-left'" />
            </button>
            <button
              type="button"
              class="layout-control"
              :aria-label="`Hide ${widgets[id].title}`"
              title="Hide box"
              :disabled="saving"
              @click="hide(id)"
            >
              <v-icon icon="mdi-close" />
            </button>
          </div>
          <component :is="widgets[id].component" />
        </div>
        <p
          v-if="editing && !column.length"
          class="layout-empty"
        >
          Drop a box here or use a move button.
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.overview-heading { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 8px; margin-bottom: 8px; }
.layout-settings { margin-bottom: 16px; font-size: 13px; color: var(--text-secondary); }
.layout-restore { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.overview-box { min-width: 0; }
.overview-dashboard--editing .overview-column { border: 1px dashed var(--border); border-radius: 6px; padding: 8px; min-height: 120px; }
.column-label, .layout-empty { color: var(--text-secondary); font-size: 12px; }
.layout-controls { display: flex; align-items: center; gap: 4px; padding: 4px; background: var(--bg-elevated); border: 1px solid var(--border); border-bottom: 0; }
.layout-box-title { flex: 1; min-width: 0; font-size: 12px; overflow-wrap: anywhere; }
.layout-control { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 36px; flex-shrink: 0; border-radius: 4px; }
.layout-control:hover:not(:disabled) { background: var(--bg-hover); }
.layout-control:disabled { opacity: 0.35; cursor: default; }
.layout-control:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 2px; }
.layout-drag { cursor: grab; }
.overview-dashboard {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  align-items: start;
}
.overview-column {
  display: grid;
  gap: 16px;
  min-width: 0;
}
@media (max-width: 959px) {
  .overview-dashboard {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
