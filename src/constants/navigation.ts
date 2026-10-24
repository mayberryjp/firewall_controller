export interface NavigationPage {
  title: string;
  name: string;
  path: string;
  icon: string;
}

export interface NavigationSection {
  title: string;
  name: string;
  path: string;
  icon: string;
  pages: NavigationPage[];
}

export const navigationSections: NavigationSection[] = [
  { title: "Overview", name: "overview-section", path: "/overview", icon: "mdi-view-dashboard-outline", pages: [
    { title: "Overview", name: "home", path: "/overview", icon: "mdi-view-dashboard-outline" },
  ] },
  { title: "Networking", name: "networking-section", path: "/networking", icon: "mdi-lan", pages: [
    { title: "Interfaces", name: "interfaces", path: "/interfaces", icon: "mdi-ethernet" },
    { title: "Adopted parents", name: "parents", path: "/parents", icon: "mdi-lock-outline" },
    { title: "Routes", name: "routes", path: "/routes", icon: "mdi-routes" },
    { title: "Source-policy rules", name: "policy-rules", path: "/policy-rules", icon: "mdi-source-branch" },
    { title: "Firewall forwarding", name: "firewall", path: "/firewall", icon: "mdi-shield-outline" },
    { title: "Host input", name: "firewall-input", path: "/firewall/input", icon: "mdi-shield-lock-outline" },
    { title: "NAT masquerading", name: "nat", path: "/nat", icon: "mdi-swap-horizontal" },
    { title: "WireGuard", name: "wireguard", path: "/wireguard", icon: "mdi-vpn" },
    { title: "Gateway monitors", name: "gateway-monitors", path: "/gateway-monitors", icon: "mdi-access-point-network" },
  ] },
  { title: "Services", name: "services-section", path: "/services", icon: "mdi-server-network", pages: [
    { title: "softflowd", name: "softflowd", path: "/services/softflowd", icon: "mdi-chart-timeline-variant" },
    { title: "DHCPv4 relay", name: "dhcp-relay", path: "/services/dhcp-relay", icon: "mdi-lan-connect" },
    { title: "Appliance NTP", name: "ntp", path: "/services/ntp", icon: "mdi-clock-outline" },
    { title: "Appliance syslog", name: "syslog", path: "/services/syslog", icon: "mdi-text-box-outline" },
    { title: "vnStat", name: "vnstat", path: "/services/vnstat", icon: "mdi-chart-bar" },
  ] },
  { title: "Changes & history", name: "activity-section", path: "/activity", icon: "mdi-history", pages: [
    { title: "Review changes", name: "changes", path: "/changes", icon: "mdi-file-compare" },
    { title: "Transactions", name: "transactions", path: "/transactions", icon: "mdi-history" },
    { title: "Committed revisions", name: "history", path: "/history", icon: "mdi-source-commit" },
  ] },
];