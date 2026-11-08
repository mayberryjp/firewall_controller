import { expect, test } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { config } from "../fixtures";
import { pathTestInterfaces, pathTestRequest, pathTestResult, pathTestStatus } from "../pathTestFixtures";
import { interfaceCapabilitySnapshot } from "../diagnosticsFixtures";
import { encodeJson } from "../../src/services/json";
import type { PathTestStatus } from "../../src/services/pathTests";

test("paired diagnostics require explicit approval, preserve cleanup ownership and allow native cancellation", async ({ page }, testInfo) => {
  const initial = config(); initial.system = { hostname: "test", domain: "example.test", timezone: "Asia/Kolkata" };
  const backend = await mockBackend(page, { initialConfig: initial, discoveredInterfaces: pathTestInterfaces() });
  let current: PathTestStatus = pathTestStatus(), starts = 0, cancels = 0, scans = 0;
  const dialogs: string[] = [];
  page.on("dialog", async dialog => { dialogs.push(dialog.type()); await dialog.dismiss(); });
  await page.route("**/proxy/interface-capabilities", route => route.fulfill({
    contentType: "application/json", body: encodeJson(interfaceCapabilitySnapshot()),
  }));
  await page.route("**/proxy/interface-capabilities/refresh", route => {
    scans++; return route.fulfill({ status: 409, contentType: "application/json", body: '{"error":"Lease is active"}' });
  });
  await page.route("**/proxy/diagnostics/path-tests**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    expect(new URL(request.url()).search).toBe("");
    if (request.method() === "GET") expect(request.postData()).toBeNull();
    else if (path.endsWith("/cancel")) {
      cancels++;
      expect(path).toMatch(new RegExp(`/diagnostics/path-tests/${"a".repeat(32)}/cancel$`));
      expect(request.postData()).toBeNull();
      current = { ...current, state: "restoring", progress: null };
    } else {
      starts++;
      expect(request.postDataJSON()).toEqual(pathTestRequest());
      current = {
        ...pathTestStatus(true), deadline_unix_ms: Date.parse("2026-11-05T05:10:00.123Z"),
        mtu_changes: [{
          interface: "vlan100", index: 4, kind: "vlan", address: [], parent: 2,
          approved: true, original_mtu: 1500, maximum_mtu: 9000, observed_mtu: 9000,
          identity_matches: true, restored: false,
        }],
      };
    }
    return route.fulfill({ status: request.method() === "POST" && !path.endsWith("/cancel") ? 202 : 200,
      contentType: "application/json", body: encodeJson(current) });
  });
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("region", { name: "Overview", exact: true })).toBeVisible();
  await page.goto("/diagnostics/path-tests");
  const view = page.getByRole("region", { name: "Path MTU/MSS", exact: true });
  const select = async (label: string, value: string) => {
    await view.getByRole("combobox", { name: label, exact: true }).press("ArrowDown");
    await page.getByRole("option", { name: value, exact: true }).click();
  };
  await select("Local interface", "VLAN100");
  await expect(view.getByLabel("Maximum MTU (bytes)", { exact: true })).toHaveValue("");
  await select("Local source IP", "192.0.2.1");
  await view.getByLabel("Peer IP", { exact: true }).fill("192.0.2.2");
  await view.getByLabel("Maximum MTU (bytes)", { exact: true }).fill("9000");
  await view.getByRole("button", { name: "Add ancestor", exact: true }).click();
  await select("Ancestor 1", "ENO1");
  await view.getByLabel("Ancestor 1 maximum MTU (bytes)", { exact: true }).fill("9100");
  await view.getByLabel("One-time pairing secret", { exact: true }).fill(pathTestRequest().pairing_secret);
  const start = view.getByRole("button", { name: "Start paired test", exact: true });
  await view.getByRole("checkbox", { name: "Approve the selected interface and disruption above", exact: true }).check();
  await expect(start).toBeDisabled();
  await view.getByRole("checkbox", { name: "Approve temporary MTU changes on ancestor 1", exact: true }).check();
  await view.getByRole("checkbox", { name: "Approve the selected interface and disruption above", exact: true }).check();
  await expect(start).toBeEnabled();
  expect(starts).toBe(0);
  await start.click();
  await expect(view).toContainText("Waiting for the peer");
  await expect(view.getByLabel("One-time pairing secret", { exact: true })).toHaveValue("");
  await expect(view.getByRole("combobox", { name: "Local interface", exact: true })).toBeDisabled();
  expect(starts).toBe(1); expect(backend.writes).toEqual([]); expect(dialogs).toEqual([]);
  current = {
    ...current, state: "cleanup_failed", progress: null, error: "Original MTU restoration needs recovery",
    result: pathTestResult(),
  };
  await view.getByRole("button", { name: "Refresh status and interfaces", exact: true }).click();
  await expect(view).toContainText("Original MTU restoration needs recovery");
  await expect(view).toContainText("Peer authentication timed out");
  await expect(view.locator("time")).toHaveText("2026-11-05 10:40:00");
  await expect(view.locator("time")).toHaveAttribute("datetime", "2026-11-05T05:10:00.123Z");
  await expect(view.getByRole("region", { name: "inbound UDP evidence" })).toContainText("Unavailable");
  await expect(start).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("paired-path-test-results.png"), fullPage: true, animations: "disabled" });
  const navigation = page.getByRole("navigation", { name: "Diagnostics pages" });
  await navigation.getByRole("tab", { name: "Interface capabilities", exact: true }).click();
  await expect(page.getByRole("button", { name: "Refresh capabilities", exact: true })).toBeDisabled();
  expect(scans).toBe(0);
  await navigation.getByRole("tab", { name: "Path MTU/MSS", exact: true }).click();
  await view.getByRole("button", { name: "Cancel and restore", exact: true }).click();
  await expect(view.getByRole("heading", { name: "restoring", exact: true })).toBeVisible();
  await expect(view).toContainText("Restoration: pending");
  expect(cancels).toBe(1); await expect(start).toBeDisabled();
  current = { ...current, active: false, state: "cancelled", restoration: "restored", error: null,
    mtu_changes: current.mtu_changes.map(row => ({ ...row, observed_mtu: row.original_mtu, restored: true })) };
  await view.getByRole("button", { name: "Refresh status and interfaces", exact: true }).click();
  await expect(view).toContainText("The temporary-state lease is released");
  await expect(view.getByRole("button", { name: "Cancel and restore", exact: true })).toHaveCount(0);
  await navigation.getByRole("tab", { name: "Interface capabilities", exact: true }).click();
  await expect(page.getByRole("button", { name: "Refresh capabilities", exact: true })).toBeEnabled();
  expect(starts).toBe(1); expect(cancels).toBe(1); expect(scans).toBe(0); expect(backend.writes).toEqual([]);
});
