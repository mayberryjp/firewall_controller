import { expect, test } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { config, systemStatus } from "../fixtures";
import { encodeJson } from "../../src/services/json";

test("NTP shows a ticking firewall clock with NTP disabled and handles backward steps and refresh failures", async ({ page }) => {
  const initial = config();
  initial.ntp = { enabled: false, servers: [] };
  initial.system = { hostname: "", domain: "", timezone: "Asia/Kolkata" };
  const backend = await mockBackend(page, { initialConfig: initial });
  let currentTime = "2026-11-19T08:58:31.123456789Z", failed = false;
  const ntpReads: string[] = [];
  page.on("request", request => {
    if (new URL(request.url()).pathname.endsWith("/services/ntp/status")) ntpReads.push(request.url());
  });
  await page.route("**/proxy/system/status", route => route.fulfill({
    status: failed ? 503 : 200, contentType: "application/json",
    body: encodeJson(failed ? { error: "system status unavailable", transaction: null } : systemStatus(currentTime)),
  }));
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("region", { name: "Overview", exact: true })).toBeVisible();
  await page.goto("/services/ntp");
  const ntp = page.getByRole("region", { name: "NTP", exact: true });
  const clock = ntp.getByLabel("Current firewall time (Asia/Kolkata)", { exact: true });
  await expect(clock).toHaveText("2026-11-19 14:28:31");
  await expect(ntp).toContainText("No servers.");
  await expect(clock).not.toHaveText("2026-11-19 14:28:31");
  await expect(clock).toHaveText(/^2026-11-19 14:28:\d{2}$/);
  currentTime = "2026-11-18T07:00:00.987654321Z";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(clock).toHaveText("2026-11-18 12:30:00");
  failed = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(ntp.getByRole("alert")).toContainText("system status unavailable");
  await expect(ntp).toContainText("stale estimate");
  await expect(clock).not.toHaveText("Unavailable");
  expect(ntpReads).toEqual([]);
  expect(backend.writes).toEqual([]);
});
