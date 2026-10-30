import { formatTimestamp } from "@/services/timestamps";
import ipaddr from "ipaddr.js";
import type { BGPRoutes, Config } from "@/types/domain";

export function isWireGuardDnsEndpoint(endpoint: string | undefined): boolean {
  const host = /^([^:]+):[1-9]\d*$/.exec(endpoint ?? "")?.[1];
  return Boolean(host && !ipaddr.isValid(host));
}

export function learnedAllowedNetworks(config: Config | undefined, routes: BGPRoutes | null, tunnelName: string, publicKey: string): Array<{ prefix: string; neighbor: string }> {
  if (!config?.bgp?.enabled || !routes || routes.state !== "running" || routes.error) return [];
  const tunnel = config.interfaces.find(link => link.name === tunnelName);
  if (tunnel?.kind !== "wireguard" || !tunnel.up) return [];
  const peer = tunnel.wireguard.peers.find(item => item.public_key === publicKey && item.enabled !== false);
  if (!peer) return [];
  const neighbors = new Set(config.bgp.neighbors.filter(neighbor =>
    neighbor.interface === tunnelName && neighbor.wireguard_public_key === publicKey).map(neighbor => neighbor.name));
  const configured = peer.allowed_ips.map(network => ipaddr.parseCIDR(network));
  const seen = new Set<string>();
  return routes.routes.filter(route => {
    if (!route.selected || !route.installed || route.reason || route.error ||
      route.interface !== tunnelName || !neighbors.has(route.neighbor) || seen.has(route.prefix)) return false;
    const [address, bits] = ipaddr.parseCIDR(route.prefix);
    if (configured.some(network => network[0].kind() === address.kind() && network[1] <= bits && address.match(network))) return false;
    seen.add(route.prefix);
    return true;
  }).map(({ prefix, neighbor }) => ({ prefix, neighbor }));
}

function ago(age: number): string {
  const plural = (value: number, unit: string) => `${value} ${unit}${value === 1 ? "" : "s"} ago`;
  if (age < 120) return plural(age, "second");
  if (age < 7200) return plural(Math.floor(age / 60), "minute");
  if (age < 172800) return plural(Math.floor(age / 3600), "hour");
  return plural(Math.floor(age / 86400), "day");
}

export function handshakeChip(seconds: number | null | undefined, keepalive: number, sampledAt: number, timeZone = "UTC"): { label: string; color: string; title: string } {
  if (!seconds) return { label: "NEVER", color: "red", title: "No handshake has completed" };
  const age = Math.max(0, Math.floor(sampledAt / 1000) - seconds);
  const when = `Last handshake ${formatTimestamp(seconds * 1000, "Unavailable", timeZone)} ${timeZone}`;
  if (!keepalive) return { label: ago(age), color: "default", title: `${when}. Keepalive is off, so there is no expected interval.` };
  const ratio = age / keepalive;
  return {
    label: ago(age), color: ratio <= 5 ? "green" : ratio <= 10 ? "yellow" : ratio <= 15 ? "orange" : "red",
    title: `${when}; ${ratio.toFixed(1)}x the ${keepalive}s keepalive. Green up to 5x, yellow up to 10x, orange up to 15x, red beyond.`,
  };
}
