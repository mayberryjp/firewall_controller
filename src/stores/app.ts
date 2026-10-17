import { defineStore } from "pinia";
import { ref } from "vue";

export const useAppStore = defineStore("app", () => {
  const navigationOpen = ref(false);

  function toggleNavigation(): void {
    navigationOpen.value = !navigationOpen.value;
  }

  return { navigationOpen, toggleNavigation };
});
