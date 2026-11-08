import { computed, ref, watch } from "vue";
import ipaddr from "ipaddr.js";
import { useControllerStore } from "@/stores/controller";
import { getSandoDevices, type SandoDevice } from "@/services/sando";

function addressKey(address: string): string {
  return ipaddr.isValid(address) ? ipaddr.parse(address).toString() : address;
}

export function useHostnames() {
  const store = useControllerStore();
  const devices = ref<SandoDevice[]>([]);
  const hostnamesError = ref("");
  watch([
    () => store.connected && store.state.data?.desired.sando?.sync_enabled
      ? store.state.data.desired.sando.api_url : "",
    () => store.sessionVersion,
  ], async ([endpoint], _, onCleanup) => {
    devices.value = []; hostnamesError.value = "";
    if (!endpoint) return;
    const controller = new AbortController();
    onCleanup(() => controller.abort());
    try {
      const inventory = await getSandoDevices(endpoint, controller.signal);
      if (!controller.signal.aborted) devices.value = inventory;
    } catch (error) {
      if (!controller.signal.aborted) hostnamesError.value = error instanceof Error
        ? error.message : "Unable to load host descriptions from Sando.";
    }
  }, { immediate: true });
  const names = computed(() => {
    const config = store.state.data?.active_transaction?.candidate ?? store.state.data?.desired;
    const result = new Map<string, string>();
    for (const host of config?.firewall.policies?.hosts ?? []) {
      const name = host.metadata?.display_name.trim() || host.name.trim();
      if (!name || ipaddr.isValid(name)) continue;
      for (const address of host.addresses) result.set(addressKey(address), name.toUpperCase());
    }
    const hostname = config?.system?.hostname.trim();
    if (hostname) {
      for (const link of config?.interfaces ?? []) for (const network of link.addresses) {
        const address = addressKey(network.split("/")[0]!);
        if (!result.has(address)) result.set(address, hostname.toUpperCase());
      }
    }
    for (const device of devices.value) {
      const description = device.local_description?.trim();
      for (const address of [device.ip_address, device.ip6_address]) {
        if (!address || !ipaddr.isValid(address)) continue;
        const key = addressKey(address);
        if (description && !ipaddr.isValid(description)) result.set(key, description.toUpperCase());
        else result.delete(key);
      }
    }
    return result;
  });
  return {
    hostnamesError,
    formatHostAddress: (address: string) => {
      const name = names.value.get(addressKey(address));
      return name ? `${name} (${address})` : address;
    },
  };
}
