import { createVuetify } from "vuetify";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";
import { mdi } from "vuetify/iconsets/mdi";
import RouterIcon from "@/components/base/RouterIcon.vue";

export default createVuetify({
  components,
  directives,
  icons: { defaultSet: "mdi", sets: { mdi }, aliases: { router: RouterIcon } },
  defaults: {
    VBtn: { rounded: "lg" },
    VCard: { rounded: "lg", elevation: 0 },
  },
  theme: {
    defaultTheme: "appTheme",
    themes: {
      appTheme: {
        dark: true,
        colors: {
          background: "#0a0c10",
          surface: "#0d1117",
          "surface-card": "#0d1117",
          "surface-variant": "#161b22",
          "on-surface-variant": "#f0f3f7",
          "background-100": "#161b22",
          "background-200": "#1c232c",
          "on-background": "#f0f3f7",
          "on-surface": "#f0f3f7",
          primary: "#4a90d9",
          secondary: "#7b61ff",
          rose: "#7b61ff",
          burgundy: "#a0364d",
          success: "#2ec4a0",
          warning: "#f5a623",
          error: "#ff5a36",
          info: "#5b8def",
        },
      },
    },
  },
});
