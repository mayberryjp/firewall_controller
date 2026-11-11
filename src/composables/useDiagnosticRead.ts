import { onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { useControllerStore } from "@/stores/controller";

export function useDiagnosticRead<T>(
  reader: (signal: AbortSignal, previous: T | null) => Promise<T>,
  interval = 3000,
  key: () => string = () => "",
  enabled: () => boolean = () => true,
) {
  const store = useControllerStore();
  const data = shallowRef<T | null>(null);
  const loading = ref(false), error = ref(""), stale = ref(false);
  let active: AbortController | undefined, timer: ReturnType<typeof setTimeout> | undefined, disposed = false;
  async function read(): Promise<void> {
    clearTimeout(timer);
    if (disposed || active || !enabled() || !store.connected || document.visibilityState === "hidden") return;
    const controller = new AbortController(), session = store.sessionVersion;
    active = controller; loading.value = true;
    const current = () => !disposed && active === controller && session === store.sessionVersion;
    try {
      const result = await reader(controller.signal, data.value);
      if (!current()) return;
      data.value = result; error.value = ""; stale.value = false;
    } catch (failure) {
      if (!current()) return;
      error.value = failure instanceof Error ? failure.message : String(failure);
      stale.value = data.value !== null;
    } finally {
      if (current()) {
        active = undefined; loading.value = false;
        timer = setTimeout(() => { void read(); }, error.value ? Math.max(interval, 5000) : interval);
      }
    }
  }
  function cancel(): void {
    clearTimeout(timer); active?.abort(); active = undefined; loading.value = false;
  }
  function wake(): void {
    if (!enabled() || document.visibilityState === "hidden") cancel();
    else void read();
  }
  watch(() => [store.connected, store.sessionVersion, key()], () => {
    cancel(); data.value = null; error.value = ""; stale.value = false;
    void read();
  }, { immediate: true, flush: "sync" });
  watch(enabled, wake);
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("online", wake);
  onBeforeUnmount(() => {
    disposed = true; cancel();
    document.removeEventListener("visibilitychange", wake); window.removeEventListener("online", wake);
  });
  return { data, loading, error, stale, read };
}
