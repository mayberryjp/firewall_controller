import { expect, test } from "@playwright/test";
import { config, monitor } from "../fixtures";
import { mockBackend } from "./mockBackend";

test("gateway monitors reserve space for names and place Status beside Actions", async ({ page }, testInfo) => {
  const initialConfig = config();
  initialConfig.gateway_monitors = [{ ...monitor(), name: "primary-uplink-monitor" }];
  await mockBackend(page, { initialConfig });
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.goto("/gateway-monitors");

  const table = page.locator(".monitors-table");
  const row = table.locator("tbody > tr").first();
  await expect(row).toContainText("primary-uplink-monitor");
  const chart = page.getByRole("region", { name: "Gateway Mean RTT", exact: true });
  await expect(chart).toBeVisible();
  const chartBounds = await chart.boundingBox();
  const addBounds = await page.getByRole("button", { name: "Add monitor", exact: true }).boundingBox();
  expect(chartBounds).not.toBeNull();
  expect(addBounds).not.toBeNull();
  expect(chartBounds!.y + chartBounds!.height).toBeLessThanOrEqual(addBounds!.y);
  await expect(table.locator("thead th")).toHaveText([
    "Name", "Interface", "Health", "Loss", "Mean RTT", "Stddev", "RTT variation", "Status", "Actions",
  ]);
  await expect(row.locator("td").nth(7).getByLabel("Monitoring enabled for primary-uplink-monitor", { exact: true })).toBeVisible();
  await expect(row.locator("td").nth(8).getByRole("button", { name: "Edit / stage", exact: true })).toBeVisible();
  if (testInfo.project.name === "chromium") {
    const widths = await table.locator("thead th").evaluateAll(cells => cells.map(cell => cell.getBoundingClientRect().width));
    expect(widths[0]).toBeGreaterThan(widths[2]!);
    expect(widths[0]).toBeGreaterThan(widths[3]!);
    expect(widths[2]).toBeCloseTo(96, 0);
    expect(widths[3]).toBeCloseTo(80, 0);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
