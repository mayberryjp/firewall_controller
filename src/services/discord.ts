import { z } from "zod";

const reference = z.string().regex(/^(?:|[a-f0-9]{32})$/, "Use a stored Discord webhook reference.");
export interface DiscordConfig { enabled: boolean; webhook_ref: string }
export const discordConfigSchema: z.ZodType<DiscordConfig, z.ZodTypeDef, { enabled?: boolean; webhook_ref?: string }> = z.object({
  enabled: z.boolean().default(false), webhook_ref: reference.default(""),
}).strict().refine(value => !value.enabled || Boolean(value.webhook_ref), {
  path: ["webhook_ref"], message: "Store a webhook before enabling Discord notifications.",
});
export const discordWebhookSchema = z.object({
  webhook_url: z.string().max(512).regex(
    /^https:\/\/discord\.com\/api\/webhooks\/[1-9][0-9]{0,19}\/[A-Za-z0-9_-]{16,256}$/,
    "Enter a canonical HTTPS discord.com webhook URL without a query, fragment or port.",
  ),
}).strict();
export const discordWebhookReferenceSchema = z.object({ webhook_ref: z.string().regex(/^[a-f0-9]{32}$/) }).strict();
export function redactDiscordError(text: string): string {
  return text.replace(/https?:[\\/]+(?:[^\s"'<>]*discord[^\s"'<>]*)/gi, "[redacted webhook]");
}
export interface DiscordStatus {
  enabled: boolean;
  state: "starting" | "disabled" | "simulated" | "unavailable" | "paused" | "ready" | "error" | "stopped";
  delivered: string; failed: string; last_drop_id: string | null; error: string | null;
  counters_scope: "daemon_session";
  deduplication: ["source", "destination", "destination_port", "protocol"];
}
export const discordStatusSchema: z.ZodType<DiscordStatus> = z.object({
  enabled: z.boolean(),
  state: z.enum(["starting", "disabled", "simulated", "unavailable", "paused", "ready", "error", "stopped"]),
  delivered: z.string().regex(/^(0|[1-9]\d*)$/), failed: z.string().regex(/^(0|[1-9]\d*)$/),
  last_drop_id: z.string().nullable(), error: z.string().transform(redactDiscordError).nullable(),
  counters_scope: z.literal("daemon_session"),
  deduplication: z.tuple([z.literal("source"), z.literal("destination"), z.literal("destination_port"), z.literal("protocol")]),
});
export const discordDefaults = (): DiscordConfig => ({ enabled: false, webhook_ref: "" });
