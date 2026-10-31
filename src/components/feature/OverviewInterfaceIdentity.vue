<script setup lang="ts">
import { computed } from "vue";
import { useControllerStore } from "@/stores/controller";

const props = defineProps<{ name: string; loopback?: boolean }>();
const store = useControllerStore();
const configured = computed(() => store.state.data?.desired.interfaces.find(item => item.name === props.name));
const role = computed(() => {
  if (props.loopback) return "Loopback";
  const value = configured.value?.role;
  return value === "unassigned" ? "Unassigned" : value?.toUpperCase();
});
</script>

<template>
  <div class="interface-identity">
    <div class="interface-heading">
      <span
        class="interface-name"
        :title="name"
      ><slot>{{ name }}</slot></span>
      <span
        v-if="role"
        class="interface-role text-medium-emphasis"
        :title="`Role: ${role}`"
      >{{ role }}</span>
    </div>
    <div
      v-if="configured?.metadata?.display_name"
      class="interface-description text-medium-emphasis"
      :title="configured.metadata.display_name"
    >
      {{ configured.metadata.display_name }}
    </div>
  </div>
</template>

<style scoped>
.interface-identity { min-width: 0; text-align: left; line-height: 14px; }
.interface-heading { display: flex; align-items: baseline; gap: 5px; }
.interface-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.interface-role { flex-shrink: 0; font-size: 10px; font-weight: 500; }
.interface-description { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; font-weight: 400; }
</style>
