import { computed } from "vue";
import { useControllerStore } from "@/stores/controller";
import { formatTimestamp as format, parseTimestamp as parse } from "@/services/timestamps";

export function useTimestamps() {
  const store = useControllerStore();
  const timeZone = computed(() => store.state.data?.desired.system?.timezone || "UTC");
  return {
    timeZone,
    formatTimestamp: (value: string | number | null | undefined, missing = "Unavailable") => format(value, missing, timeZone.value),
    parseTimestamp: (value: string) => parse(value, timeZone.value),
  };
}
