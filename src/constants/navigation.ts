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
  { title: "Interfaces", name: "networking-section", path: "/networking", icon: "mdi-lan", pages: [
    { title: "Physical interfaces", name: "interfaces", path: "/interfaces", icon: "mdi-lan" },
    { title: "VLANs", name: "vlans", path: "/vlans", icon: "mdi-lan" },
    { title: "Loopbacks", name: "loopbacks", path: "/loopbacks", icon: "mdi-restore" },
  ] },
  { title: "Routing", name: "routing-section", path: "/routing", icon: "mdi-transit-connection-variant", pages: [
    { title: "Static Routes", name: "routes", path: "/routes", icon: "mdi-transit-connection-variant" },
    { title: "Gateway monitors", name: "gateway-monitors", path: "/gateway-monitors", icon: "mdi-access-point-network" },
  ] },
  { title: "Firewall", name: "firewall-section", path: "/firewall", icon: "mdi-wall", pages: [
    { title: "Firewall forwarding", name: "firewall", path: "/firewall", icon: "mdi-wall" },
    { title: "Host input", name: "firewall-input", path: "/firewall/input", icon: "mdi-wall" },
    { title: "Connections", name: "connections", path: "/connections", icon: "mdi-transit-connection-variant" },
    { title: "NAT masquerading", name: "nat", path: "/nat", icon: "mdi-swap-horizontal" },
  ] },
  { title: "VPN", name: "vpn-section", path: "/vpn", icon: "mdi-wan", pages: [
    { title: "WireGuard", name: "wireguard", path: "/wireguard", icon: "mdi-wan" },
  ] },
  { title: "Services", name: "services-section", path: "/services", icon: "mdi-apps", pages: [
    { title: "softflowd", name: "softflowd", path: "/services/softflowd", icon: "mdi-chart-timeline-variant" },
    { title: "DHCPv4 relay", name: "dhcp-relay", path: "/services/dhcp-relay", icon: "mdi-lan-connect" },
    { title: "Appliance NTP", name: "ntp", path: "/services/ntp", icon: "mdi-clock-outline" },
    { title: "Appliance syslog", name: "syslog", path: "/services/syslog", icon: "mdi-text-box-outline" },
    { title: "vnStat", name: "vnstat", path: "/services/vnstat", icon: "mdi-chart-bar" },
    { title: "Maintenance", name: "service-maintenance", path: "/services/maintenance", icon: "mdi-wrench-outline" },
  ] },
  { title: "Settings", name: "settings-section", path: "/settings", icon: "mdi-cog-outline", pages: [
    { title: "General", name: "settings-general", path: "/settings/general", icon: "mdi-cog-outline" },
  ] },
  { title: "Config", name: "config-section", path: "/config", icon: "mdi-history", pages: [
    { title: "SAVE", name: "changes", path: "/config/changes", icon: "mdi-file-compare" },
    { title: "Commits", name: "commits", path: "/config/commits", icon: "mdi-source-commit" },
    { title: "PUSH REQUESTS", name: "history", path: "/config/revisions", icon: "mdi-history" },
  ] },
];

export const primaryNavigationSections = navigationSections.filter(section => !["overview-section", "config-section"].includes(section.name));