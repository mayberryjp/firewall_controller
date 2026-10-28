import { formatTimestamp } from "@/services/timestamps";

function ago(age: number): string {
  const plural = (value: number, unit: string) => `${value} ${unit}${value === 1 ? "" : "s"} ago`;
  if (age < 120) return plural(age, "second");
  if (age < 7200) return plural(Math.floor(age / 60), "minute");
  if (age < 172800) return plural(Math.floor(age / 3600), "hour");
  return plural(Math.floor(age / 86400), "day");
}

export function handshakeChip(seconds: number | null | undefined, keepalive: number, sampledAt: number): { label: string; color: string; title: string } {
  if (!seconds) return { label: "NEVER", color: "red", title: "No handshake has completed" };
  const age = Math.max(0, Math.floor(sampledAt / 1000) - seconds);
  const when = `Last handshake ${formatTimestamp(seconds * 1000)} UTC`;
  if (!keepalive) return { label: ago(age), color: "default", title: `${when}. Keepalive is off, so there is no expected interval.` };
  const ratio = age / keepalive;
  return {
    label: ago(age), color: ratio <= 5 ? "green" : ratio <= 10 ? "yellow" : ratio <= 15 ? "orange" : "red",
    title: `${when}; ${ratio.toFixed(1)}x the ${keepalive}s keepalive. Green up to 5x, yellow up to 10x, orange up to 15x, red beyond.`,
  };
}
