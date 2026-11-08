import { describe, expect, it } from "vitest";
import { discordConfigSchema, discordDefaults, discordStatusSchema, discordWebhookSchema } from "@/services/discord";
import { configSchema } from "@/types/domain";
import { cloneConfig, differences, differenceContext, requiredPermissions, validateConfig, equalConfig } from "@/services/configuration";
import { config } from "../fixtures";
import { discordStatus, webhookReference, webhookUrl } from "../discordFixtures";

describe("Discord notification contracts", () => {
  it("defaults to disabled and keeps only a device-local reference in configuration", () => {
    expect(discordConfigSchema.parse({})).toEqual(discordDefaults());
    const candidate = config();
    candidate.discord = { enabled: true, webhook_ref: webhookReference };
    expect(configSchema.parse(candidate).discord).toEqual(candidate.discord);
    expect(JSON.stringify(cloneConfig(candidate))).not.toContain("discord.com");
    expect(validateConfig(candidate)).toEqual([]);
    expect(equalConfig(config(), { ...config(), discord: discordDefaults() })).toBe(true);
  });
  it.each([
    null, { enabled: true, webhook_ref: "" }, { enabled: true, webhook_ref: "A".repeat(32) },
    { enabled: true, webhook_ref: webhookUrl }, { enabled: 1, webhook_ref: webhookReference },
    { enabled: false, webhook_ref: webhookReference, webhook_url: webhookUrl },
  ])("rejects invalid configuration or embedded credentials", value => {
    expect(discordConfigSchema.safeParse(value).success).toBe(false);
  });
  it("accepts provider-only canonical URL boundaries", () => {
    for (const id of ["1", "9".repeat(20)]) for (const token of ["a".repeat(16), "a".repeat(256)]) {
      expect(discordWebhookSchema.parse({ webhook_url: `https://discord.com/api/webhooks/${id}/${token}` }).webhook_url)
        .toBe(`https://discord.com/api/webhooks/${id}/${token}`);
    }
  });
  it.each([
    webhookUrl.replace("https:", "http:"), webhookUrl.replace("discord.com", "discordapp.com"),
    webhookUrl.replace("discord.com", "discord.com.example.org"), webhookUrl.replace("discord.com", "user@discord.com"),
    webhookUrl.replace("discord.com", "discord.com:443"), `${webhookUrl}?wait=true`, `${webhookUrl}#x`, `${webhookUrl}/`,
    webhookUrl.replace("123456789", "0"), webhookUrl.replace("123456789", "0".repeat(21)),
    webhookUrl.replace("abcdefghijklmnop", "short"), webhookUrl.replace("abcdefghijklmnop", "a".repeat(257)),
    webhookUrl.replace("abcdefghijklmnop", "%61".repeat(16)), ` ${webhookUrl}`, `${webhookUrl} `,
  ])("rejects noncanonical or unauthorized webhook URLs without echoing input", value => {
    const result = discordWebhookSchema.safeParse({ webhook_url: value });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).not.toContain(value);
  });
  it("tracks enable/disable/reference changes and their permission and diff context", () => {
    const before = config(), after = cloneConfig(before);
    after.discord = { enabled: true, webhook_ref: webhookReference };
    const diff = differences(before, after);
    expect(diff).toHaveLength(1);
    expect(diff[0]?.area).toBe("discord");
    expect(requiredPermissions(diff)).toEqual(["transactions.write", "discord.write"]);
    expect(differenceContext(before, after, diff[0]!).after.discord).toEqual(after.discord);
    expect(requiredPermissions(differences(after, before))).toEqual(["transactions.write", "discord.write"]);
  });
  it("preserves exact counters, checks tuple semantics and redacts URLs from status errors", () => {
    const sample = { ...discordStatus(), delivered: "18446744073709551615", failed: "9007199254740993", error: `Rejected ${webhookUrl}` };
    const parsed = discordStatusSchema.parse(sample);
    expect(parsed.delivered).toBe(sample.delivered);
    expect(parsed.failed).toBe(sample.failed);
    expect(parsed.error).toBe("Rejected [redacted webhook]");
    expect(discordStatusSchema.safeParse({ ...sample, delivered: 1 }).success).toBe(false);
    expect(discordStatusSchema.safeParse({ ...sample, deduplication: ["source", "destination"] }).success).toBe(false);
  });
});
