import type { RouteRecordRaw } from "vue-router";

const publicRoutes: RouteRecordRaw[] = [
  {
    path: "/connect",
    name: "connect",
    component: () => import("@/views/ConnectView.vue"),
  },
  { path: "/", redirect: "/overview" },
];

export default publicRoutes;
