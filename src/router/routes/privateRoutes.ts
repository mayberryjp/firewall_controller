import type { RouteRecordRaw } from "vue-router";
import SectionLayout from "@/components/layout/SectionLayout.vue";
import { navigationSections } from "@/constants/navigation";

const sectionPages: Record<string, RouteRecordRaw[]> = {
  "overview-section": [
    { path: "", name: "home", component: () => import("@/views/HomeView.vue") },
  ],
  "networking-section": [
    { path: "/interfaces", name: "interfaces", component: () => import("@/views/InterfacesView.vue") },
    { path: "/interfaces/:name", name: "interface-detail", component: () => import("@/views/InterfaceDetailView.vue"), props: true, meta: { navigationPage: "interfaces" } },
    { path: "/parents", name: "parents", component: () => import("@/views/ParentsView.vue") },
    { path: "/routes", name: "routes", component: () => import("@/views/RoutesView.vue") },
    { path: "/policy-rules", name: "policy-rules", component: () => import("@/views/PolicyRulesView.vue") },
    { path: "/firewall", name: "firewall", component: () => import("@/views/FirewallView.vue") },
    { path: "/nat", name: "nat", component: () => import("@/views/NATView.vue") },
    { path: "/wireguard", name: "wireguard", component: () => import("@/views/WireGuardView.vue") },
    { path: "/gateway-monitors", name: "gateway-monitors", component: () => import("@/views/GatewayMonitorsView.vue") },
  ],
  "services-section": [
    { path: "/services/softflowd", name: "softflowd", component: () => import("@/views/SoftflowdView.vue") },
    { path: "/services/softflowd/:name", name: "softflowd-detail", component: () => import("@/views/SoftflowdDetailView.vue"), props: true, meta: { navigationPage: "softflowd" } },
    { path: "/services/dhcp-relay", name: "dhcp-relay", component: () => import("@/views/DHCPRelayView.vue") },
    { path: "/services/ntp", name: "ntp", component: () => import("@/views/NTPView.vue") },
    { path: "/services/syslog", name: "syslog", component: () => import("@/views/SyslogView.vue") },
    { path: "/services/vnstat", name: "vnstat", component: () => import("@/views/VnStatView.vue") },
  ],
  "activity-section": [
    { path: "/changes", name: "changes", component: () => import("@/views/ChangesView.vue") },
    { path: "/transactions", name: "transactions", component: () => import("@/views/TransactionsView.vue") },
    { path: "/transactions/:id", name: "transaction-detail", component: () => import("@/views/TransactionDetailView.vue"), props: true, meta: { navigationPage: "transactions" } },
    { path: "/history", name: "history", component: () => import("@/views/HistoryView.vue") },
    { path: "/history/:revision", name: "revision-detail", component: () => import("@/views/RevisionDetailView.vue"), props: true, meta: { navigationPage: "history" } },
  ],
};

const privateRoutes: RouteRecordRaw[] = navigationSections.map(section => ({
  path: section.path,
  name: section.name,
  component: SectionLayout,
  props: { section },
  ...(section.path !== section.pages[0]!.path ? { redirect: { name: section.pages[0]!.name } } : {}),
  meta: { authenticated: true },
  children: sectionPages[section.name] ?? [],
}));

export default privateRoutes;
