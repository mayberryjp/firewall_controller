import type { RouteRecordRaw } from "vue-router";

const errorRoutes: RouteRecordRaw[] = [
  {
    path: "/error",
    name: "error",
    component: () => import("@/views/ErrorView.vue"),
  },
  {
    path: "/:pathMatch(.*)*",
    name: "not-found",
    component: () => import("@/views/ErrorView.vue"),
  },
];

export default errorRoutes;
