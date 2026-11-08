import type { DiscordStatus } from "@/services/discord";

export const webhookReference = "a".repeat(32);
export const webhookUrl = "https://discord.com/api/webhooks/123456789/abcdefghijklmnop";
export function discordStatus(): DiscordStatus {
  return {
    enabled: false, state: "disabled", delivered: "0", failed: "0", last_drop_id: null, error: null,
    counters_scope: "daemon_session", deduplication: ["source", "destination", "destination_port", "protocol"],
  };
}
