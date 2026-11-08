import { computed } from "vue";
import ipaddr from "ipaddr.js";
import { useControllerStore } from "@/stores/controller";

function addressKey(address: string): string {
  return ipaddr.isValid(address) ? ipaddr.parse(address).toString() : address;
}

export function useHostnames() {
  const store = useControllerStore();
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
    return result;
  });
  return {
    formatHostAddress: (address: string) => {
      const name = names.value.get(addressKey(address));
      return name ? `${name} (${address})` : address;
    },
  };
}
