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
    { title: "Blackhole interfaces", name: "blackhole", path: "/blackhole", icon: "mdi-cancel" },
    { title: "Tunnel interfaces", name: "tunnels", path: "/tunnels", icon: "mdi-tunnel-outline" },
  ] },
  { title: "Routing", name: "routing-section", path: "/routing", icon: "mdi-transit-connection-variant", pages: [
    { title: "Static Routes", name: "routes", path: "/routes", icon: "mdi-transit-connection-variant" },
    { title: "Gateway monitors", name: "gateway-monitors", path: "/gateway-monitors", icon: "mdi-access-point-network" },
    { title: "BGP PROCESS", name: "bgp", path: "/routing/bgp", icon: "mdi-router-network" },
    { title: "BGP PEERS", name: "bgp-peers", path: "/routing/bgp/peers", icon: "mdi-account-network-outline" },
  ] },
  { title: "Firewall/NAT", name: "firewall-section", path: "/firewall", icon: "mdi-wall", pages: [
    { title: "Firewall forwarding", name: "firewall", path: "/firewall", icon: "mdi-wall" },
    { title: "Host input", name: "firewall-input", path: "/firewall/input", icon: "mdi-wall" },
    { title: "Connections", name: "connections", path: "/connections", icon: "mdi-transit-connection-variant" },
    { title: "NAT masquerading", name: "nat", path: "/nat", icon: "mdi-swap-horizontal" },
    { title: "DNAT", name: "dnat", path: "/firewall/nat/dnat", icon: "mdi-swap-horizontal" },
  ] },
  { title: "VPN", name: "vpn-section", path: "/vpn", icon: "mdi-wan", pages: [
    { title: "WireGuard peers", name: "wireguard", path: "/wireguard", icon: "mdi-wan" },
  ] },
  { title: "Services", name: "services-section", path: "/services", icon: "mdi-apps", pages: [
    { title: "NetFlow/IPFIX", name: "netflow", path: "/services/netflow", icon: "mdi-chart-timeline-variant" },
    { title: "DHCPv4 relay", name: "dhcp-relay", path: "/services/dhcp-relay", icon: "mdi-lan-connect" },
    { title: "Remote DNS", name: "remote-dns", path: "/services/remote-dns", icon: "mdi-dns-outline" },
    { title: "mDNS / Discovery", name: "mdns", path: "/services/mdns", icon: "mdi-access-point-network" },
    { title: "UDP BROADCAST RELAY", name: "udp-broadcast-relay", path: "/services/udp-broadcast-relay", icon: "mdi-broadcast" },
    { title: "NTP", name: "ntp", path: "/services/ntp", icon: "mdi-clock-outline" },
    { title: "Syslog", name: "syslog", path: "/services/syslog", icon: "mdi-text-box-outline" },
    { title: "vnStat", name: "vnstat", path: "/services/vnstat", icon: "mdi-chart-bar" },
  ] },
  { title: "Diagnostics", name: "diagnostics-section", path: "/diagnostics", icon: "mdi-chart-line", pages: [
    { title: "REAL TIME TRAFFIC", name: "real-time-traffic", path: "/diagnostics/traffic", icon: "mdi-chart-line" },
    { title: "Process health", name: "process-health", path: "/diagnostics/process-health", icon: "mdi-heart-pulse" },
    { title: "Interface drops", name: "interface-drops", path: "/diagnostics/interface-drops", icon: "mdi-lan-check" },
    { title: "QDISCS", name: "qdiscs", path: "/diagnostics/qdiscs", icon: "mdi-format-list-numbered" },
    { title: "TCP WINDOWING", name: "tcp-windowing", path: "/diagnostics/tcp-windowing", icon: "mdi-swap-horizontal" },
    { title: "Capture details", name: "capture-details", path: "/diagnostics/capture-details", icon: "mdi-clipboard-check-outline" },
    { title: "API explorer", name: "api-explorer", path: "/diagnostics/api", icon: "mdi-api" },
    { title: "BGP ROUTES", name: "bgp-routes", path: "/diagnostics/bgp-routes", icon: "mdi-router-network" },
    { title: "Download config", name: "download-config", path: "/diagnostics/download-config", icon: "mdi-download" },
  ] },
  { title: "Settings", name: "settings-section", path: "/settings", icon: "mdi-cog-outline", pages: [
    { title: "General", name: "settings-general", path: "/settings/general", icon: "mdi-cog-outline" },
    { title: "MQTT STREAMING", name: "settings-mqtt-streaming", path: "/settings/mqtt-streaming", icon: "mdi-home-assistant" },
    { title: "Dynamic DNS", name: "settings-dynamic-dns", path: "/settings/dynamic-dns", icon: "mdi-dns-outline" },
  ] },
  { title: "Config", name: "config-section", path: "/config", icon: "mdi-history", pages: [
    { title: "SAVE", name: "changes", path: "/config/changes", icon: "mdi-file-compare" },
    { title: "Commits", name: "commits", path: "/config/commits", icon: "mdi-source-commit" },
    { title: "PUSH REQUESTS", name: "history", path: "/config/revisions", icon: "mdi-history" },
  ] },
];

export const primaryNavigationSections = navigationSections.filter(section => !["overview-section", "config-section"].includes(section.name));