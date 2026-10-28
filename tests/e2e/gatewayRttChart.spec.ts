import { expect, test } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { config, gatewayStatistics, monitor } from "../fixtures";

test("gateway Mean RTT chart stays compact and updates every monitor", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const initialConfig = config();
  initialConfig.gateway_monitors = [monitor(), { ...monitor(), name: "backup" }];
  const backend = await mockBackend(page, { initialConfig });
  let reads = 0;
  await page.route("**/proxy/statistics/gateways", route => {
    const index = reads++;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({
      sample: { scope: "host", status: "available", started_at: null, collected_at: new Date().toISOString() },
      monitors: [
        { ...gatewayStatistics(), rtt_avg_ms: 5 + index },
        { ...gatewayStatistics(), name: "backup", rtt_avg_ms: 15 + index },
      ],
    }) });
  });
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.goto("/gateway-monitors");
  const chart = page.getByRole("region", { name: "Gateway Mean RTT", exact: true });
  await expect(chart.locator(".apexcharts-canvas")).toBeVisible();
  await expect(chart.locator(".apexcharts-legend")).toContainText("uplink");
  await expect(chart.locator(".apexcharts-legend")).toContainText("backup");
  await expect(chart.locator(".apexcharts-line-series .apexcharts-series")).toHaveCount(2);
  await expect(chart).toContainText("Mean RTT (ms)");
  await expect(chart).toContainText("Time (UTC)");
  const table = page.getByRole("table").first();
  const tableBox = await table.boundingBox(), chartBox = await chart.boundingBox();
  expect(tableBox).not.toBeNull(); expect(chartBox).not.toBeNull();
  expect(chartBox!.y + chartBox!.height).toBeLessThanOrEqual(tableBox!.y);
  expect(await chart.locator(".apexcharts-canvas").evaluate(element => element.getBoundingClientRect().height)).toBe(200);
  await expect.poll(() => reads, { timeout: 15000 }).toBeGreaterThanOrEqual(3);
  await expect.poll(() => chart.locator(".apexcharts-line").first().evaluate(path => (path as SVGPathElement).getTotalLength())).toBeGreaterThan(10);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(backend.writes).toHaveLength(0);
  expect(errors).toEqual([]);
});
