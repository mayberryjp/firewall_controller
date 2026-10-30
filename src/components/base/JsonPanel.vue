<script setup lang="ts">
import { computed } from "vue";
import { isTimestamp } from "@/services/timestamps";
import { useTimestamps } from "@/composables/useTimestamps";
const { formatTimestamp, timeZone } = useTimestamps();
const props = defineProps<{ value: unknown; label?: string }>();
function fields(value: unknown, path = "", key = ""): Array<{ label: string; value: string }> {
  if (Array.isArray(value) && value.some(item => item !== null && typeof item === "object")) {
    return value.flatMap((item, index) => fields(item, `${path} ${index + 1}`.trim(), key));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value);
    if (entries.length) return entries.flatMap(([key, item]) => fields(item, [path, key.replaceAll("_", " ")].filter(Boolean).join(" / "), key));
  }
  if (isTimestamp(value) || (key === "acquired_at" && typeof value === "number")) {
    return [{ label: `${(path || "Value").replace(/^./, letter => letter.toUpperCase())} (${timeZone.value})`, value: formatTimestamp(typeof value === "number" ? value * 1000 : value) }];
  }
  const display = value === null || value === undefined ? "Unavailable" : Array.isArray(value) ? value.map(item => isTimestamp(item) ? `${formatTimestamp(item)} ${timeZone.value}` : String(item)).join(", ") || "None" : typeof value === "boolean" ? value ? "Yes" : "No" : String(value) || "None";
  return [{ label: (path || "Value").replace(/^./, letter => letter.toUpperCase()), value: display }];
}
const rows = computed(() => fields(props.value));
</script>
<template>
  <details class="data-details">
    <summary>{{ label || "Details" }}</summary>
    <dl>
      <template
        v-for="row in rows"
        :key="row.label"
      >
        <dt>{{ row.label }}</dt>
        <dd>{{ row.value }}</dd>
      </template>
    </dl>
  </details>
</template>

<style scoped>
.data-details {
  margin-block: 8px;
  min-width: 0;
}
summary {
  cursor: pointer;
  padding-block: 8px;
}
dl {
  display: grid;
  grid-template-columns: minmax(100px, 1fr) minmax(0, 2fr);
  gap: 8px 16px;
  padding-block: 8px;
  font-size: 13px;
}
dt {
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}
dd {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
