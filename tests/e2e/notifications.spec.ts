import { expect, test } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { discordStatus, webhookReference, webhookUrl } from "../discordFixtures";
import { encodeJson } from "../../src/services/json";

test("Notifications matches General Settings and privately stages Discord through SAVE and explicit confirmation", async ({ page, isMobile }, testInfo) => {
  const backend = await mockBackend(page);
  const longWebhookUrl = `${webhookUrl}${"a".repeat(200)}`;
  let currentStatus = discordStatus(), uploads = 0, tests = 0;
  const dialogs: string[] = [];
  page.on("dialog", async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.route("**/proxy/services/discord/status", route => route.fulfill({ contentType: "application/json", body: encodeJson(currentStatus) }));
  await page.route("**/proxy/services/discord/webhooks", route => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({ webhook_url: longWebhookUrl });
    uploads++;
    return route.fulfill({ status: 201, contentType: "application/json", body: encodeJson({ webhook_ref: webhookReference }) });
  });
  await page.route("**/proxy/services/discord/test", route => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postData()).toBeNull();
    tests++;
    currentStatus = { ...currentStatus, failed: "0", error: null };
    return route.fulfill({ contentType: "application/json", body: encodeJson({
      delivered: true, backend_version: "2026.11.14.1", config_version: "2026.11.14.3", failed: "0",
    }) });
  });
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("region", { name: "Overview", exact: true })).toBeVisible();
  await page.goto("/settings/notifications");
  const settings = page.getByRole("region", { name: "Notification settings", exact: true });
  await expect(settings.locator(".setting-row")).toHaveCount(5);
  await expect(settings.locator(".setting-name")).toHaveText([
    "Enable firewall drop notifications", "Webhook URL", "Broadcast drop notifications",
    "TCP FIN/RST/empty ACK notifications", "Notification status",
  ]);
  await expect(settings.getByRole("heading", { name: "Firewall drop notifications", exact: true })).toBeVisible();
  await expect(settings).not.toContainText("Committed delivery");
  await expect(settings.getByRole("button")).toHaveCount(2);
  await expect(settings.getByRole("button", { name: "Send Discord test", exact: true })).toBeDisabled();
  await expect(settings.locator("details, [role='dialog']")).toHaveCount(0);
  await expect(settings.locator(".v-chip")).toHaveText(["Delivered: 0", "Failed: 0"]);
  await expect(settings.locator(".v-chip").first()).toHaveClass(/text-success/);
  await expect(settings.locator(".v-chip").nth(1)).toHaveClass(/text-error/);
  await expect(settings).not.toContainText("Counts for this session");
  const columns = await settings.locator(".setting-row").first().evaluate(row => getComputedStyle(row).gridTemplateColumns.split(" "));
  expect(columns).toHaveLength(isMobile ? 1 : 2);
  if (!isMobile) expect(columns[0]).toBe("240px");
  const fieldWidth = await settings.locator(".setting-field").evaluate(field => ({
    actual: field.getBoundingClientRect().width,
    available: field.parentElement!.getBoundingClientRect().width,
  }));
  expect(fieldWidth.actual).toBeCloseTo(fieldWidth.available, 0);
  await expect(settings.locator(".v-field--variant-outlined")).toHaveCount(0);
  const enable = settings.getByRole("checkbox", { name: "Enable firewall drop notifications", exact: true });
  const secret = settings.getByLabel("Discord webhook URL", { exact: true });
  await expect(enable).toBeEnabled();
  const broadcast = settings.getByRole("checkbox", { name: "Broadcast drop notifications", exact: true });
  const tcp = settings.getByRole("checkbox", { name: "TCP FIN/RST/empty ACK notifications", exact: true });
  await expect(broadcast).not.toBeChecked(); await expect(tcp).not.toBeChecked();
  await broadcast.check(); await tcp.check();
  await expect(secret).toHaveAttribute("type", "password");
  await enable.check();
  await secret.fill(longWebhookUrl);
  await expect(secret).toHaveValue(longWebhookUrl);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await expect(settings).toContainText("Webhook stored; notification changes staged");
  await expect(secret).toHaveValue("");
  await expect(settings).not.toContainText(longWebhookUrl);
  await expect(settings.locator(".v-chip")).toHaveText(["Delivered: 0", "Failed: 0"]);
  expect(uploads).toBe(1);
  expect(backend.writes).toEqual([]);
  expect(dialogs).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("notifications.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("link", { name: "Save configuration", exact: true }).click();
  await page.getByRole("button", { name: "Commit & push", exact: true }).click();
  const push = page.getByRole("dialog");
  await expect(push).toContainText("discord.write");
  await push.getByRole("button", { name: "Push changes", exact: true }).click();
  await expect(push.getByRole("button", { name: "Confirm changes", exact: true })).toBeEnabled();
  expect(backend.writes.find(write => write.path === "/transactions")?.body).toMatchObject({
    config: { discord: { enabled: true, webhook_ref: webhookReference, notify_broadcast: true, notify_tcp_closures: true } }, confirm_timeout_seconds: 120,
  });
  expect(JSON.stringify(backend.writes)).not.toContain(longWebhookUrl);
  expect(backend.writes.filter(write => write.path.endsWith("/confirm"))).toHaveLength(0);
  await push.getByRole("button", { name: "Confirm changes", exact: true }).click();
  await expect(push).not.toBeVisible();
  currentStatus = { ...discordStatus(), enabled: true, state: "ready", delivered: "7", failed: "2", notify_broadcast: true, notify_tcp_closures: true };
  await page.goto("/settings/notifications");
  await expect(enable).toBeChecked();
  await expect(broadcast).toBeChecked(); await expect(tcp).toBeChecked();
  await expect(settings.locator(".v-chip")).toHaveText(["Active", "Delivered: 7", "Failed: 2"]);
  await expect(settings.locator(".v-chip").first()).toHaveClass(/text-success/);
  await expect(settings.locator(".v-chip").nth(2)).toHaveClass(/text-error/);
  await expect(secret).toHaveValue("");
  await expect(settings).toContainText("Replacement webhook URL");
  await expect(settings.locator(".setting-row").nth(1).locator(".setting-name")).toHaveText("Replacement webhook URL");
  const sendTest = settings.getByRole("button", { name: "Send Discord test", exact: true });
  await expect(settings.locator(".setting-row").last().getByRole("button", { name: "Send Discord test" })).toBeVisible();
  await expect(sendTest).toHaveClass(/bg-primary/);
  await expect(sendTest).toHaveClass(/v-btn--variant-elevated/);
  await expect(sendTest).toHaveClass(/v-btn--size-default/);
  if (!isMobile) {
    const group = settings.getByRole("group", { name: "Delivery statistics" });
    const failed = await group.locator(".v-chip").last().boundingBox();
    const button = await sendTest.boundingBox();
    expect(button!.x).toBeGreaterThan(failed!.x + failed!.width);
    expect(button!.y + button!.height / 2).toBeCloseTo(failed!.y + failed!.height / 2, 0);
  }
  await sendTest.click();
  await expect(settings).toContainText("Backend: 2026.11.14.1; configuration: 2026.11.14.3");
  await expect(settings.locator(".v-chip")).toHaveText(["Active", "Delivered: 7", "Failed: 0"]);
  expect(tests).toBe(1);
  await enable.uncheck();
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await expect(settings).toContainText("Notification changes staged");
  expect(uploads).toBe(1);
  expect(dialogs).toEqual([]);
});

test("Notifications keeps unsupported backends disabled without attempting uploads", async ({ page }) => {
  const backend = await mockBackend(page);
  await page.route("**/proxy/services/discord/status", route => route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"Unsupported endpoint"}' }));
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("region", { name: "Overview", exact: true })).toBeVisible();
  await page.goto("/settings/notifications");
  const settings = page.getByRole("region", { name: "Notification settings", exact: true });
  await expect(settings.getByRole("alert")).toContainText("HTTP 404");
  await expect(settings.getByRole("checkbox", { name: "Enable firewall drop notifications", exact: true })).toBeDisabled();
  await expect(settings.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  expect(backend.writes).toEqual([]);
});
