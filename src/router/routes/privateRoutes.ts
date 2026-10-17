import type { RouteRecordRaw } from "vue-router";

const privateRoutes: RouteRecordRaw[] = [
  { path: "/overview", name: "home", component: () => import("@/views/HomeView.vue"), meta: { authenticated: true } },
  ...["/interfaces", "/interfaces/:name", "/routes", "/policy-rules", "/firewall", "/nat", "/wireguard",
    "/services/softflowd", "/services/softflowd/:name"].map((path) => ({
    path, component: () => import("@/views/ResourceView.vue"), meta: { authenticated: true },
  })),
  { path: "/parents", component: () => import("@/views/ParentsView.vue"), meta: { authenticated: true } },
  { path: "/services/dhcp-relay", component: () => import("@/views/DHCPRelayView.vue"), meta: { authenticated: true } },
  { path: "/changes", component: () => import("@/views/ChangesView.vue"), meta: { authenticated: true } },
  { path: "/transactions", component: () => import("@/views/TransactionsView.vue"), meta: { authenticated: true } },
  { path: "/transactions/:id", component: () => import("@/views/TransactionsView.vue"), meta: { authenticated: true } },
  { path: "/history", component: () => import("@/views/HistoryView.vue"), meta: { authenticated: true } },
  { path: "/history/:revision", component: () => import("@/views/HistoryView.vue"), meta: { authenticated: true } },
];

export default privateRoutes;
