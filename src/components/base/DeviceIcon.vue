<script setup lang="ts">
import { computed } from "vue";
import defaultIcon from "@/assets/deviceicons/DEFAULT.svg";

const props = defineProps<{ name?: string | null; score?: string | number | boolean | null }>();
const icons = import.meta.glob<string>("../../assets/deviceicons/*.svg", { eager: true, query: "?url", import: "default" });
const iconName = computed(() => {
  const name = props.name?.trim().toUpperCase() || "DEFAULT";
  return icons[`../../assets/deviceicons/${name}.svg`] ? name : "DEFAULT";
});
const iconUrl = computed(() => icons[`../../assets/deviceicons/${iconName.value}.svg`] ?? defaultIcon);
const color = computed(() => {
  if (typeof props.score !== "number" && (typeof props.score !== "string" || !props.score.trim())) return "#b1b8c0";
  const score = Number(props.score);
  if (!Number.isInteger(score) || score < 0) return "#b1b8c0";
  if (score === 0) return "#00C853";
  if (score <= 24) return "#FFD600";
  if (score <= 50) return "#FF9800";
  if (score <= 75) return "#F44336";
  return "#B71C1C";
});
</script>

<template>
  <span
    class="device-icon"
    aria-hidden="true"
    :data-device-icon="iconName"
    :style="{ maskImage: `url(${JSON.stringify(iconUrl)})`, color }"
  />
</template>

<style scoped>
.device-icon {
  display: inline-block;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  background-color: currentColor;
  color: #b1b8c0;
  mask-position: center;
  mask-size: contain;
  mask-repeat: no-repeat;
}
</style>
