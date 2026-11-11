import { onBeforeUnmount, ref, watch } from "vue";
import { useControllerStore } from "@/stores/controller";
import { ApiFailure } from "@/services/api";
import { getInterfaceCapabilities, refreshInterfaceCapabilities } from "@/services/netcontrol";
import { hideRssIrqNavigation, type InterfaceCapabilitySnapshot } from "@/services/interfaceCapabilities";

export function useInterfaceCapabilities(enabled: () => boolean = () => true) {
  const store = useControllerStore();
  const snapshot = ref<InterfaceCapabilitySnapshot | null>(null);
  const completed = ref(false), loading = ref(false), error = ref("");
  const stale = ref(false), refreshDenied = ref(false);
  let active: AbortController | null = null;

  async function read(refresh = false) {
    if (!enabled() || !store.connected || loading.value || (refresh && refreshDenied.value)) return;
    if (refresh && store.pathTestWriteBlockedReason) {
      error.value = store.pathTestWriteBlockedReason;
      return;
    }
    const controller = new AbortController(), session = store.sessionVersion;
    const observationVersion = ++store.rssIrqNavigation.version;
    active = controller; loading.value = true;
    const current = () => active === controller && session === store.sessionVersion;
    try {
      const result = await (refresh ? refreshInterfaceCapabilities : getInterfaceCapabilities)(controller.signal);
      if (!current()) return;
      snapshot.value = result; completed.value = true; stale.value = false; error.value = "";
      if (observationVersion === store.rssIrqNavigation.version) store.rssIrqNavigation.hidden = hideRssIrqNavigation(result);
    } catch (failure) {
      if (!current()) return;
      error.value = failure instanceof Error ? failure.message : String(failure);
      if (refresh && (!(failure instanceof ApiFailure) || failure.status == null || failure.incompatible)) {
        error.value += " Refresh outcome is unknown; no scan was automatically repeated.";
      }
      stale.value = snapshot.value !== null;
      if (observationVersion === store.rssIrqNavigation.version) store.rssIrqNavigation.hidden = false;
      if (failure instanceof ApiFailure && failure.status === 403) refreshDenied.value = true;
    } finally {
      if (current()) { loading.value = false; active = null; }
    }
  }
  watch(() => [store.connected, store.sessionVersion, enabled()], () => {
    active?.abort(); active = null;
    snapshot.value = null; completed.value = false; loading.value = false; error.value = "";
    stale.value = false; refreshDenied.value = false;
    if (store.connected && enabled()) void read();
  }, { immediate: true, flush: "sync" });
  onBeforeUnmount(() => { active?.abort(); active = null; });
  return { snapshot, completed, loading, error, stale, refreshDenied, read };
}
