import { expect, test } from "@playwright/test";
import { config, gatewayStatistics, monitor } from "../fixtures";
import { mockBackend } from "./mockBackend";

test("tables match compact counters without alternating row bands", async ({ page, isMobile }, testInfo) => {
  const initialConfig = config();
  initialConfig.gateway_monitors = [monitor(), { ...monitor(), name: "backup" }];
  const backend = await mockBackend(page, { initialConfig });
  await page.route("**/proxy/statistics/gateways", route => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ monitors: [gatewayStatistics(), { ...gatewayStatistics(), name: "backup" }] }),
  }));
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();

  const counters = page.getByRole("region", { name: "Interface counters", exact: true });
  const counterRow = counters.locator("tbody tr").first();
  await expect(counterRow).toBeVisible();
  const baseline = await counterRow.evaluate(row => row.getBoundingClientRect().height);
  expect(baseline).toBe(34);
  const gateways = page.getByRole("region", { name: "Gateways", exact: true });
  await expect(gateways.locator("tbody tr")).toHaveCount(2);
  for (const title of ["Gateways", "WireGuard", "System stats"]) {
    const widget = page.getByRole("region", { name: title, exact: true });
    const row = widget.locator("tbody tr").first();
    expect(await row.evaluate(element => element.getBoundingClientRect().height)).toBe(baseline);
  }
  for (const table of await page.locator(".overview-widget .v-table").all()) {
    const rowStyles = await table.locator("tbody tr").evaluateAll(rows => rows.map(row => {
      const style = getComputedStyle(row);
      return { background: style.backgroundColor, image: style.backgroundImage };
    }));
    expect(rowStyles.length).toBeGreaterThan(0);
    for (const style of rowStyles) {
      expect(style).toEqual({ background: "rgba(0, 0, 0, 0)", image: "none" });
    }
    expect(await table.locator("thead tr").evaluate(row => row.getBoundingClientRect().height)).toBe(baseline);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("compact-unbanded-tables.png"), fullPage: true });

  await page.goto("/config/revisions");
  await expect(page.locator("main .v-table tbody tr").first()).toBeVisible();
  const table = page.locator("main .v-table").first();
  expect(await table.evaluate(element => {
    const style = getComputedStyle(element);
    return [style.getPropertyValue("--v-table-row-height").trim(), style.getPropertyValue("--v-table-header-height").trim()];
  })).toEqual(["34px", "34px"]);
  const headerHeight = await table.locator("thead tr").evaluate(row => row.getBoundingClientRect().height);
  if (isMobile) expect(headerHeight).toBeGreaterThanOrEqual(baseline);
  else expect(headerHeight).toBe(baseline);
  expect(backend.writes).toHaveLength(0);
});
