<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useDisplay } from "vuetify";
import type { NavigationSection } from "@/constants/navigation";

const props = defineProps<{ section: NavigationSection }>();
const showNavigation = computed(() => props.section.pages.length > 1 || ["settings-section", "diagnostics-section"].includes(props.section.name));
const route = useRoute();
const selectedPage = computed(() => route.meta.navigationPage ?? route.name);
const { lgAndUp } = useDisplay();
const collapsible = computed(() => ["connections", "firewall", "firewall-drops"].some(name => name === route.name));
const collapsed = ref(collapsible.value);
watch(() => route.name, () => { collapsed.value = collapsible.value; });
</script>

<template>
  <v-sheet
    class="section-layout"
    :class="{ 'section-layout--with-navigation': showNavigation, 'section-layout--collapsed': lgAndUp && collapsed }"
    color="surface-card"
  >
    <nav
      v-if="showNavigation"
      class="section-navigation"
      :aria-label="`${section.title} pages`"
    >
      <v-btn
        v-if="lgAndUp && collapsible"
        :icon="collapsed ? 'mdi-menu-open' : 'mdi-menu'"
        :aria-label="`${collapsed ? 'Expand' : 'Collapse'} ${section.title} navigation`"
        :title="`${collapsed ? 'Expand' : 'Collapse'} ${section.title} navigation`"
        :aria-expanded="!collapsed"
        variant="text"
        size="small"
        class="navigation-toggle"
        @click="collapsed = !collapsed"
      />
      <v-tabs
        v-if="!lgAndUp || !collapsed"
        :model-value="selectedPage"
        :direction="lgAndUp ? 'vertical' : 'horizontal'"
        :aria-orientation="lgAndUp ? 'vertical' : 'horizontal'"
        :aria-label="`${section.title} pages`"
        :show-arrows="!lgAndUp"
        color="primary"
      >
        <v-tab
          v-for="page in section.pages"
          :key="page.name"
          :value="page.name"
          :to="{ name: page.name }"
          :exact="page.name !== selectedPage"
          :aria-label="page.title"
          :aria-current="selectedPage === page.name ? 'page' : undefined"
        >
          {{ page.title }}
        </v-tab>
      </v-tabs>
    </nav>
    <div class="section-content">
      <router-view :key="route.path" />
    </div>
  </v-sheet>
</template>

<style scoped>
.section-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  height: 100%;
  min-width: 0;
}
.section-navigation,
.section-content {
  min-width: 0;
}
.section-layout--with-navigation > .section-content {
  padding: 8px 0 0;
}
.section-navigation :deep(.v-tab) {
  letter-spacing: 0;
}
@media (min-width: 1280px) {
  .section-layout--with-navigation {
    grid-template-columns: minmax(0, 1fr) minmax(0, 3fr);
  }
  .section-layout--with-navigation > .section-content {
    padding: 16px 0 0 16px;
  }
  .section-layout--collapsed { grid-template-columns: 48px minmax(0, 1fr); }
  .navigation-toggle { margin: 4px; }
}
</style>