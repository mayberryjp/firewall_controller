import type { RouteRecordRaw } from "vue-router";
import SectionLayout from "@/components/layout/SectionLayout.vue";
import { navigationSections } from "@/constants/navigation";

const sectionPages: Record<string, RouteRecordRaw[]> = {
  "overview-section": [
    { path: "", name: "home", component: () => import("@/views/HomeView.vue") },
  ],
  "networking-section": [
    { path: "/loopbacks", name: "loopbacks", component: () => import("@/views/LoopbacksView.vue") },
    { path: "/blackhole", name: "blackhole", component: () => import("@/views/BlackholeView.vue") },
    { path: "/tunnels", name: "tunnels", component: () => import("@/views/TunnelsView.vue") },
    { path: "/interfaces", name: "interfaces", component: () => import("@/views/InterfacesView.vue") },
    { path: "/interfaces/:name", name: "interface-detail", component: () => import("@/views/InterfaceDetailView.vue"), props: true, meta: { navigationPage: "interfaces" } },
    { path: "/vlans", name: "vlans", component: () => import("@/views/VLANsView.vue") },
    { path: "/vlans/:name", name: "vlan-detail", component: () => import("@/views/VLANsView.vue"), props: true, meta: { navigationPage: "vlans" } },
  ],
  "routing-section": [
    { path: "/routes", name: "routes", component: () => import("@/views/RoutesView.vue") },
    { path: "/policy-rules", name: "policy-rules", redirect: "/routes" },
    { path: "/gateway-monitors", name: "gateway-monitors", component: () => import("@/views/GatewayMonitorsView.vue") },
  ],
  "firewall-section": [
    { path: "/firewall", name: "firewall", component: () => import("@/views/FirewallView.vue") },
    { path: "/firewall/input", name: "firewall-input", component: () => import("@/views/FirewallInputView.vue") },
    { path: "/connections", name: "connections", component: () => import("@/views/ConnectionsView.vue") },
    { path: "/nat", name: "nat", component: () => import("@/views/NATView.vue") },
  ],
  "vpn-section": [
    { path: "/wireguard", name: "wireguard", component: () => import("@/views/WireGuardView.vue") },
    { path: "/wireguard/:name", name: "wireguard-detail", component: () => import("@/views/WireGuardView.vue"), props: true, meta: { navigationPage: "wireguard" } },
  ],
  "services-section": [
    { path: "/services/netflow", name: "netflow", component: () => import("@/views/SoftflowdView.vue") },
    { path: "/services/netflow/:name", name: "netflow-detail", component: () => import("@/views/SoftflowdDetailView.vue"), props: true, meta: { navigationPage: "netflow" } },
    { path: "/services/dhcp-relay", name: "dhcp-relay", component: () => import("@/views/DHCPRelayView.vue") },
    { path: "/services/ntp", name: "ntp", component: () => import("@/views/NTPView.vue") },
    { path: "/services/syslog", name: "syslog", component: () => import("@/views/SyslogView.vue") },
    { path: "/services/vnstat", name: "vnstat", component: () => import("@/views/VnStatView.vue") },
    { path: "/services/maintenance", name: "service-maintenance", component: () => import("@/views/ServiceMaintenanceView.vue") },
  ],
  "settings-section": [
    { path: "/settings/general", name: "settings-general", component: () => import("@/views/SettingsView.vue") },
    { path: "/settings/mqtt-streaming", name: "settings-mqtt-streaming", component: () => import("@/views/HomeAssistantView.vue") },
    { path: "/settings/home-assistant", redirect: { name: "settings-mqtt-streaming" } },
    { path: "/settings/dynamic-dns", name: "settings-dynamic-dns", component: () => import("@/views/DynamicDnsView.vue") },
  ],
  "config-section": [
    { path: "/config/changes", name: "changes", component: () => import("@/views/ChangesView.vue") },
    { path: "/config/commits", name: "commits", component: () => import("@/views/TransactionsView.vue") },
    { path: "/config/commits/:id", name: "transaction-detail", component: () => import("@/views/TransactionDetailView.vue"), props: true, meta: { navigationPage: "commits" } },
    { path: "/config/revisions", name: "history", component: () => import("@/views/HistoryView.vue") },
    { path: "/config/revisions/:revision", name: "revision-detail", component: () => import("@/views/RevisionDetailView.vue"), props: true, meta: { navigationPage: "history" } },
    { path: "/activity", redirect: { name: "changes" } },
    { path: "/changes", redirect: { name: "changes" } },
    { path: "/transactions", redirect: { name: "commits" } },
    { path: "/transactions/:id", redirect: to => ({ name: "transaction-detail", params: to.params, query: to.query, hash: to.hash }) },
    { path: "/history", redirect: { name: "history" } },
    { path: "/history/:revision", redirect: to => ({ name: "revision-detail", params: to.params, query: to.query, hash: to.hash }) },
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
