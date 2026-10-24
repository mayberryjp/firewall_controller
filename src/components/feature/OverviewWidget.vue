<script setup lang="ts">
defineProps<{ title: string; to: string; note?: string; detail?: string }>();
</script>

<template>
  <v-card
    tag="section"
    :aria-label="title"
    border
    rounded="sm"
    class="overview-widget"
  >
    <header class="widget-header">
      <h2>{{ title }}</h2>
      <span
        v-if="note"
        class="widget-note text-medium-emphasis"
        :title="detail"
      >{{ note }}</span>
      <v-btn
        :to="to"
        :aria-label="`Open ${title}`"
        :title="`Open ${title}`"
        icon="mdi-arrow-top-right"
        variant="text"
        size="x-small"
      />
    </header>
    <slot />
  </v-card>
</template>

<style scoped>
.overview-widget {
  min-width: 0;
}
.widget-header {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 0 12px;
  background: var(--bg-elevated);
  border-bottom: var(--app-border);
}
.widget-header h2 {
  flex: 1;
  font-size: 15px;
  font-weight: 600;
}
.widget-note {
  font-size: 12px;
}
.overview-widget :deep(.v-table) {
  font-size: 13px;
}
.overview-widget :deep(th),
.overview-widget :deep(td) {
  height: 34px !important;
  padding: 6px 12px !important;
  white-space: nowrap;
}
.overview-widget :deep(tbody tr:nth-child(even)) {
  background: rgb(255 255 255 / 3%);
}
</style>