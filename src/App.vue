<script setup lang="ts">
import AppShell from "@/components/layout/AppShell.vue";
import { onUnmounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useControllerStore } from "@/stores/controller";
import { usePolling } from "@/composables/usePolling";
const store = useControllerStore(), route = useRoute(), router = useRouter();
usePolling();
watch(() => route.path, (path) => { store.monitoring = path === "/overview" || path.startsWith("/interfaces/"); }, { immediate: true });
watch(() => store.connected, (connected) => {
  if (!connected && route.path !== "/connect") void router.replace({ name: "connect", query: { redirect: route.fullPath } });
});
function warnUnload(event: BeforeUnloadEvent): void {
  if (store.editorDirty || store.draft || store.busy || store.uncertain) { event.preventDefault(); event.returnValue = ""; }
}
window.addEventListener("beforeunload", warnUnload);
onUnmounted(() => window.removeEventListener("beforeunload", warnUnload));
</script>

<template>
  <AppShell>
    <router-view />
  </AppShell>
</template>
