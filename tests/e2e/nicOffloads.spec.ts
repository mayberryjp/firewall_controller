import { expect, test } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { config } from "../fixtures";
import { interfaceCapabilitySnapshot, rpsDiagnostics } from "../diagnosticsFixtures";
import { nicOffloadFeatures } from "../../src/services/tuning";
import { encodeJson } from "../../src/services/json";

test("offloads use compact General-settings rows with separate configuration and cached status", async ({ page }, testInfo) => {
  const initial = config();
  initial.system = { hostname: "", domain: "", timezone: "Asia/Kolkata" };
  initial.interfaces.push(...["eno1", "eno2"].map(name => ({
    ...initial.interfaces[0]!, kind: "ethernet" as const, name, role: "wan" as const, addresses: [],
  })));
  const backend = await mockBackend(page, { initialConfig: initial });
  const snapshot = interfaceCapabilitySnapshot(), performance = rpsDiagnostics();
  const first = snapshot.inventory.interfaces[0]!;
  first.capabilities = nicOffloadFeatures.map(feature => ({
    name: `ethtool:${feature}`, support: "supported", enabled: feature !== "rx-lro", evidence: ["Cached driver evidence"], reason: null,
  }));
  snapshot.inventory.interfaces.push({ ...first, name: "eno2", index: 3 });
  performance.interfaces!.push({ ...performance.interfaces![0]!, name: "eno2", index: 3 });
  await page.route("**/proxy/interface-capabilities", route => route.fulfill({ contentType: "application/json", body: encodeJson(snapshot) }));
  await page.route("**/proxy/statistics/performance", route => route.fulfill({ contentType: "application/json", body: encodeJson(performance) }));
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("region", { name: "Overview", exact: true })).toBeVisible();
  await page.goto("/diagnostics/nic-offloads");
  const view = page.getByRole("region", { name: "NIC Offloads", exact: true });
  const choose = async (label: string, value: string) => {
    await view.getByRole("combobox", { name: label, exact: true }).press("ArrowDown");
    await page.getByRole("option", { name: value, exact: true }).click();
    await expect(page.locator(".v-select__content:visible")).toHaveCount(0);
  };
  await expect(view.locator(".setting-row")).toHaveCount(4);
  await expect(view.locator("table")).toHaveCount(0);
  await expect(view.locator(".v-chip")).toHaveCount(0);
  await choose("Desired rx-checksum for eno1", "Off");
  await choose("Interface", "eno2");
  await choose("Desired rx-checksum for eno2", "On");
  await choose("Interface", "eno1");
  await expect(view.getByRole("combobox", { name: "Desired rx-checksum for eno1", exact: true })).toHaveValue("Off");
  for (const [category, count] of [["Sending", 8], ["Receiving", 4], ["VLAN tags", 4], ["Checksums", 4]] as const) {
    await choose("Category", category);
    await expect(view.locator(".setting-row")).toHaveCount(count);
    expect(await view.locator(".offload-settings").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await view.getByRole("button", { name: "Status", exact: true }).click();
  const status = view.getByRole("region", { name: "NIC offload status", exact: true });
  await expect(status.locator(".v-chip")).toHaveCount(4);
  await expect(status.locator(".v-chip").first()).toHaveText("Enabled");
  await expect(view.getByRole("combobox", { name: "Desired rx-checksum for eno1", exact: true })).toHaveCount(0);
  await expect(view.getByRole("button", { name: "STAGE CHANGES", exact: true })).toHaveCount(0);
  await expect(view.locator("time")).toHaveText("2026-11-04 10:40:00");
  await expect(view.locator("time")).toHaveAttribute("datetime", "2026-11-04T05:10:00.123456Z");
  await page.screenshot({ path: testInfo.outputPath("nic-offload-status.png"), fullPage: true, animations: "disabled" });
  await view.getByRole("button", { name: "Configuration", exact: true }).click();
  await expect(view.getByRole("combobox", { name: "Desired rx-checksum for eno1", exact: true })).toHaveValue("Off");
  await view.getByRole("button", { name: "STAGE CHANGES", exact: true }).click();
  await expect(view).toContainText("Performance changes staged");
  expect(backend.writes).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("nic-offload-configuration.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("link", { name: "Save configuration", exact: true }).click();
  await page.getByRole("button", { name: "Commit & push", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Push changes", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Confirm changes", exact: true })).toBeEnabled();
  expect(backend.writes.find(write => write.path === "/transactions")!.body).toMatchObject({
    config: { kernel: { offloads: { eno1: { "rx-checksum": false }, eno2: { "rx-checksum": true } } } },
  });
  await dialog.getByRole("button", { name: "Confirm changes", exact: true }).click();
  await expect(dialog).not.toBeVisible();
});
