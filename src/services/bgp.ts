import type { BGPNeighbor, BGPStatus } from "@/types/domain";

export function bgpPeerStatus(peer: BGPNeighbor, enabled: boolean, status: BGPStatus | null, current: boolean) {
  const observation = current ? status?.neighbors?.find(row => row.name === peer.name && row.address === peer.address && row.interface === peer.interface) : undefined;
  const state = !enabled ? "disabled" : !current ? "unknown" :
    status?.state !== "running" ? status?.state ?? "unknown" : observation?.state ?? "unknown";
  const label = state.replaceAll("_", " ").replace(/^./, char => char.toUpperCase());
  const color = state === "established" ? "success" : state === "error" || state === "stopped" ? "error" :
    ["active", "open_sent", "open_confirm", "starting"].includes(state) ? "warning" : "default";
  return { label, color, observation };
}
