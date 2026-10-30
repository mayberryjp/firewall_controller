import { expect, test, type Page } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { config, software } from "../fixtures";
import type { SoftwareMetadata } from "../../src/types/domain";
import { encodeJson } from "../../src/services/json";

async function connect(page: Page): Promise<void> {
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("region", { name: "Overview", exact: true })).toBeVisible();
}

test("default release checks work with installation disabled and wait for fresh metadata", async ({ page }) => {
  const initialConfig = { ...config(), software: { ...software(), repository: "mayberryjp/firewall_backend", latest_version: "2026.10.29.1", update_available: false, last_checked_at: "2026-10-29T00:00:00Z" } };
  const backend = await mockBackend(page, { initialConfig });
  let installationReads = 0;
  await page.route("**/proxy/system/upgrade", route => {
    expect(route.request().method()).toBe("GET"); installationReads++;
    return route.fulfill({ contentType: "application/json", body: encodeJson({
      enabled: false, repository: null, job: null, last_successful_version: null,
    }) });
  });
  let checks = 0, completed = false;
  await page.route("**/proxy/state", route => {
    const saved = { ...initialConfig, software: { ...initialConfig.software, last_checked_at: completed ? "2026-10-30T01:02:03.123456789Z" : initialConfig.software.last_checked_at } };
    return route.fulfill({ contentType: "application/json", body: encodeJson({ revision: "2026.10.29.1", desired: saved, observed: saved, drift: false }) });
  });
  await page.route("**/proxy/system/upgrade/check", route => {
    checks++; expect(route.request().method()).toBe("POST"); expect(route.request().postData()).toBeNull();
    expect(new URL(route.request().url()).search).toBe("");
    return route.fulfill({ status: 202, contentType: "application/json", body: '{"status":"check_requested"}' });
  });
  await connect(page); await page.goto("/config/upgrade");
  const upgrade = page.getByRole("region", { name: "System upgrade", exact: true });
  await expect(upgrade).toContainText("Up to date"); expect(checks).toBe(0);
  expect(installationReads).toBeGreaterThan(0);
  const check = upgrade.getByRole("button", { name: "Check for upgrade", exact: true });
  await check.click();
  await expect(upgrade.getByRole("status")).toHaveText("Checking..."); await expect(check).toBeDisabled();
  await expect(upgrade).not.toContainText("Up to date");
  completed = true;
  await expect(upgrade).toContainText("2026-10-30 01:02:03", { timeout: 15_000 });
  await expect(upgrade.getByRole("status")).toHaveText("Up to date"); await expect(check).toBeEnabled();
  expect(checks).toBe(1); expect(backend.writes).toEqual([]);
  await expect(page.getByRole("link", { name: "Save configuration", exact: true })).toHaveText("R2026.10.29.1");
});

test("legacy numeric-revision appliances can log in and stage changes without software metadata", async ({ page }) => {
  const backend = await mockBackend(page);
  const legacyConfig = config();
  await page.route("**/proxy/state", route => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ revision: 79, desired: legacyConfig, observed: legacyConfig, drift: false }),
  }));
  await connect(page);
  await expect(page.getByRole("link", { name: "Save configuration", exact: true })).toHaveText("R79");
  await page.goto("/routes");
  await page.getByRole("button", { name: "Edit / stage", exact: true }).click();
  await page.getByLabel("Metric", { exact: true }).fill("42");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("link", { name: "Save configuration", exact: true })).toHaveText("R79");
  await page.goto("/config/upgrade");
  const upgrade = page.getByRole("region", { name: "System upgrade", exact: true });
  await expect(upgrade).toContainText("Update the appliance backend to enable upgrade checks.");
  await expect(upgrade.getByRole("button", { name: "Check for upgrade", exact: true })).toBeDisabled();
  expect(backend.writes).toEqual([]);
});

test("Config Upgrade shows only versions, last checked and a check button", async ({ page }, testInfo) => {
  const initialConfig = {
    ...config(), software: {
      ...software(), version: "2026.10.29.9", repository: "operator/appliance", latest_version: "2026.10.29.10",
      update_available: true, last_checked_at: "2026-10-29T23:00:01.123456789Z",
    },
  };
  const backend = await mockBackend(page, { initialConfig });
  const installs: unknown[] = [];
  await page.route("**/proxy/system/upgrade", route => {
    if (route.request().method() === "POST") {
      installs.push(route.request().postData());
      return route.fulfill({ status: 400, contentType: "application/json", body: '{"error":"Unexpected install request"}' });
    }
    return route.fulfill({ contentType: "application/json", body: encodeJson({
      enabled: true, repository: "operator/appliance", last_successful_version: null, job: null,
    }) });
  });
  await connect(page);
  await page.getByRole("link", { name: "Save configuration", exact: true }).click();
  await page.getByRole("navigation", { name: "Config pages" }).getByRole("tab", { name: "Upgrade", exact: true }).click();
  await expect(page).toHaveURL(/\/config\/upgrade$/);
  await expect(page.getByRole("tab", { name: "Upgrade", exact: true })).toHaveAttribute("aria-current", "page");
  const upgrade = page.getByRole("region", { name: "System upgrade", exact: true });
  await expect(upgrade.getByRole("status")).toHaveText("Update available: 2026.10.29.10");
  await expect(upgrade).toContainText("2026-10-29 23:00:01");
  await expect(upgrade).not.toContainText("123456789");
  await expect(upgrade.locator("dt")).toHaveText(["Current version", "New version", "Last checked (UTC)"]);
  await expect(upgrade.getByRole("button")).toHaveCount(1);
  await expect(upgrade.getByRole("button", { name: "Check for upgrade", exact: true })).toBeEnabled();
  await expect(upgrade.getByRole("textbox")).toHaveCount(0);
  await expect(upgrade).not.toContainText("operator/appliance");
  await expect(page.getByRole("main")).not.toContainText("signing");
  await page.screenshot({ path: testInfo.outputPath("config-upgrade.png"), fullPage: true, animations: "disabled" });
  expect(installs).toEqual([]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(backend.writes).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const [metadata, message] of [
  [{}, "Not checked"],
  [{ repository: null }, "Checks disabled"],
  [{ latest_version: "2026.10.29.1", update_available: false }, "Up to date"],
  [{ error: "GitHub rate limit reached", last_checked_at: "2026-10-29T23:00:00Z" }, "Unable to check"],
] satisfies Array<[Partial<SoftwareMetadata>, string]>) {
  test(`Config Upgrade shows ${message} without writes`, async ({ page }) => {
    const backend = await mockBackend(page, {
      initialConfig: { ...config(), software: { ...software(), repository: "operator/appliance", ...metadata } },
    });
    await connect(page);
    await page.goto("/settings/upgrade");
    await expect(page).toHaveURL(/\/config\/upgrade$/);
    const upgrade = page.getByRole("region", { name: "System upgrade", exact: true });
    await expect(upgrade.getByRole("status")).toHaveText(message);
    if ("error" in metadata) await expect(upgrade.getByRole("alert")).toContainText(metadata.error!);
    await expect(upgrade.getByRole("button")).toHaveCount(1);
    if (metadata.repository === null) await expect(upgrade.getByRole("button")).toBeDisabled();
    expect(backend.writes).toEqual([]);
  });
}
