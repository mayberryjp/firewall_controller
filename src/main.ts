import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "@/App.vue";
import router from "@/router";
import vuetify from "@/plugins/vuetify";
import "vuetify/styles";
import "@mdi/font/css/materialdesignicons.css";
import "@/assets/styles/tokens.css";
import "@/assets/styles/globals.css";

document.title = import.meta.env.VITE_APP_NAME || "Firewall Controller";

createApp(App).use(createPinia()).use(router).use(vuetify).mount("#app");
