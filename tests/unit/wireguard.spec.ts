import { describe, expect, it } from "vitest";
import { handshakeChip } from "@/services/wireguard";

describe("WireGuard handshake display", () => {
  const sampledAt = Date.parse("2026-10-28T04:00:00.987Z");
  it.each([
    [125, "green"], [126, "yellow"], [250, "yellow"], [251, "orange"], [375, "orange"], [376, "red"],
  ])("colors a %i-second handshake using the keepalive thresholds", (age, color) => {
    expect(handshakeChip(Math.floor(sampledAt / 1000) - age, 25, sampledAt).color).toBe(color);
  });
  it.each([null, undefined, 0])("marks %s as never handshaken", seconds => {
    expect(handshakeChip(seconds, 25, sampledAt)).toMatchObject({ label: "NEVER", color: "red" });
  });
  it("keeps keepalive-off neutral and formats the tooltip in UTC without fractional seconds", () => {
    expect(handshakeChip(Math.floor(sampledAt / 1000) - 30, 0, sampledAt)).toEqual({
      label: "30 seconds ago", color: "default",
      title: "Last handshake 2026-10-28 03:59:30 UTC. Keepalive is off, so there is no expected interval.",
    });
  });
});
