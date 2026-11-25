import { expect, test } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { config } from "../fixtures";
import { sandoSchema } from "../../src/services/sandoState";
import { sandoStatus } from "../sandoFixtures";

for (const flag of ["sync_enabled", "policy_sync_enabled"] as const)
for (const enabled of [true, false]) test(`server Sando ${flag} can be ${enabled ? "enabled" : "disabled"} through SAVE without browser syncs`, async ({ page }) => {
  const initialConfig = config();
  initialConfig.system = { hostname: "", domain: "", timezone: "Asia/Tokyo" };
  initialConfig.sando = sandoSchema.parse({ api_url: "https://sando.example", [flag]: !enabled });
  const backend = await mockBackend(page, { initialConfig, sandoStatus: sandoStatus() });
  const sourceRequests: string[] = [], syncWrites: string[] = [];
  await page.route("https://sando.example/**", route => {
    sourceRequests.push(route.request().url());
    return route.abort();
  });
  page.on("request", request => {
    if (request.method() !== "GET" && request.url().includes("/sando")) syncWrites.push(request.url());
  });
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("region", { name: "Overview", exact: true })).toBeVisible();
  await page.goto("/settings/sando");
  await expect(page.getByRole("button", { name: /Test sync|Import hosts|Import rules|Stop import/ })).toHaveCount(0);
  await expect(page.getByLabel("Last successful host sync", { exact: true })).toHaveText("Last successful host sync (Asia/Tokyo): 2026-10-30 23:00:00");
  await expect(page.getByLabel("Last successful policy sync", { exact: true })).toHaveText("Last successful policy sync (Asia/Tokyo): 2026-10-31 04:30:08");
  const sync = page.getByLabel(flag === "sync_enabled" ? "Automatic host and threat-score sync" : "Automatically sync policies", { exact: true });
  await expect(sync).toBeEnabled();
  await sync.setChecked(enabled);
  await expect(sync).toBeChecked({ checked: enabled });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(backend.writes).toEqual([]);
  expect(sourceRequests).toEqual([]); expect(syncWrites).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("link", { name: "Save configuration", exact: true }).click();
  await page.getByRole("button", { name: "Commit & push", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("sando.write");
  await expect(page.getByRole("dialog")).toContainText("firewall.write");
  await page.getByRole("button", { name: "Push changes", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm changes", exact: true }).click();
  await expect(page.getByRole("region", { name: "Commit detail", exact: true })).toContainText("committed");
  expect(backend.writes.map(write => write.path)).toEqual(["/transactions", "/transactions/tx-test/confirm"]);
  expect(backend.writes[0]).toMatchObject({ body: { config: {
    sando: { api_url: "https://sando.example", [flag]: enabled, [flag === "sync_enabled" ? "policy_sync_enabled" : "sync_enabled"]: false },
    firewall: initialConfig.firewall,
  } } });
  await page.goto("/settings/sando");
  await expect(sync).toBeChecked({ checked: enabled });
  expect(sourceRequests).toEqual([]); expect(syncWrites).toEqual([]);
});
