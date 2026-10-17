import { createRouter, createWebHistory } from "vue-router";
import publicRoutes from "@/router/routes/publicRoutes";
import privateRoutes from "@/router/routes/privateRoutes";
import errorRoutes from "@/router/routes/errorRoutes";
import { useControllerStore } from "@/stores/controller";

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [...publicRoutes, ...privateRoutes, ...errorRoutes],
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach((to) => {
  const store = useControllerStore();
  if (store.editorDirty && !window.confirm("Discard unstaged form input? Your shared draft is preserved.")) return false;
  if (to.meta.authenticated && !store.connected) return { name: "connect", query: { redirect: to.fullPath } };
});

router.onError((error, to) => {
  console.error("Router navigation failed", error);
  if (to.name !== "error") {
    void router.replace({ name: "error", query: { code: "navigation" } }).catch((redirectError: unknown) => {
      console.error("Unable to display navigation error page", redirectError);
    });
  }
});

export default router;
