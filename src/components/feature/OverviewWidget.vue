<script setup lang="ts">
defineProps<{ title: string; to?: string; titleTo?: string; note?: string; detail?: string }>();
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
      <h2>
        <RouterLink
          v-if="titleTo"
          :to="titleTo"
          class="widget-title-link"
        >
          {{ title }}
        </RouterLink>
        <template v-else>
          {{ title }}
        </template>
      </h2>
      <span
        v-if="note"
        class="widget-note text-medium-emphasis"
        :title="detail"
      >{{ note }}</span>
      <v-btn
        v-if="to"
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
.widget-title-link { color: inherit; text-decoration: none; }
.overview-widget :deep(.v-table) {
  font-size: 13px;
}
.overview-widget :deep(th),
.overview-widget :deep(td) {
  padding: 2px 12px !important;
  white-space: nowrap;
}
</style>