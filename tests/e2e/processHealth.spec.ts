import { expect, test } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { processHealthSnapshot } from "../fixtures";

test("Diagnostics process health refreshes and clears recovered alerts without writes", async ({ page, isMobile }, testInfo) => {
  const backend = await mockBackend(page);
  let recovered = false, reads = 0;
  await page.route("**/proxy/platform/status", route => {
    reads++;
    const snapshot = processHealthSnapshot();
    if (recovered) {
      snapshot.process_health.status = "healthy"; snapshot.process_health.healthy = true;
      snapshot.process_health.components[0]!.state = "running";
      snapshot.process_health.components[0]!.healthy = true;
      snapshot.process_health.components[0]!.retrying = false;
      snapshot.active_alerts = [];
    }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(snapshot) });
  });
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  if (isMobile) await page.getByRole("button", { name: "Open navigation menu", exact: true }).click();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Diagnostics", exact: true }).click();
  await page.getByRole("navigation", { name: "Diagnostics pages" }).getByRole("tab", { name: "Process health", exact: true }).click();
  await expect(page).toHaveURL(/\/diagnostics\/process-health$/);
  const health = page.getByRole("region", { name: "Process health", exact: true });
  await expect(health.locator(".health-summary .v-chip").first()).toHaveText("Unhealthy");
  await expect(health.getByRole("row", { name: /ntp/ })).toContainText("Recovering");
  await expect(health).toContainText("Collected (UTC): 2026-10-27 01:02:03");
  await expect(health).toContainText("First seen (UTC): 2026-10-27 01:02:03");
  await expect(health).toContainText("Last seen (UTC): 2026-10-27 01:02:03");
  await expect(health.getByRole("list", { name: "Process alerts" })).toContainText("NTP worker is unavailable");
  const before = reads;
  recovered = true;
  await expect(health.locator(".health-summary .v-chip").first()).toHaveText("Healthy", { timeout: 8000 });
  expect(reads).toBeGreaterThan(before);
  await expect(health.getByRole("row", { name: /ntp/ })).toContainText("Running");
  await expect(health.getByRole("row", { name: /ntp/ })).not.toContainText("Recovering");
  await expect(health).toContainText("No active alerts.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("process-health.png"), fullPage: true, animations: "disabled" });
  expect(backend.writes).toHaveLength(0);
});
