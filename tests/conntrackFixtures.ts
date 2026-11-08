import type { KernelTunable, KernelTunables } from "@/services/conntrack";

export function conntrackCatalog(): KernelTunable[] {
  return [
    "max", "tcp_timeout_established", "tcp_timeout_close", "tcp_timeout_close_wait",
    "tcp_timeout_fin_wait", "tcp_timeout_last_ack", "tcp_timeout_time_wait", "udp_timeout", "udp_timeout_stream",
  ].map(suffix => ({
    name: `net.netfilter.nf_conntrack_${suffix}`, scope: suffix === "max" ? "host" : "namespace",
    kind: "integer", min: suffix === "max" ? 1024 : 1, max: suffix === "max" ? 16777216 : 604800,
    count: 1, description: suffix === "max" ? "Higher capacity permits more memory use." : "Short timeouts can expire idle flows.",
  }));
}
export function conntrackSnapshot(): KernelTunables {
  const empty = () => ({ host: {}, namespace: {} });
  return {
    desired: empty(), configured: empty(), effective: empty(), observed: empty(),
    captured_original: empty(), drift: false,
  };
}
