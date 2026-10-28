import { expect, test } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { healthSnapshot, trafficStatistics } from "../fixtures";

test("Overview metric links show live ApexCharts without link styling and drill into traffic", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const backend = await mockBackend(page);
  let hostReads = 0, trafficReads = 0;
  await page.route("**/proxy/statistics/host", route => {
    const index = hostReads++;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(
      healthSnapshot(String(9007199254740993n + BigInt(index) * 25n), String(9007199254740993n + BigInt(index) * 75n), 100 + index * 3),
    ) });
  });
  await page.route("**/proxy/statistics", route => {
    const index = trafficReads++;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(trafficStatistics(index * 3, BigInt(index) * 300n)) });
  });
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const system = page.getByRole("region", { name: "System stats", exact: true });
  await expect(system.getByRole("button", { name: "CPU usage", exact: true })).toBeVisible();
  await expect(system.getByRole("row", { name: /Uptime/ }).locator("button, a")).toHaveCount(0);
  await expect(system.getByRole("row", { name: /Root filesystem/ }).locator("button, a")).toHaveCount(0);
  for (const name of ["CPU usage", "Memory", "Swap", "Load (1 / 5 / 15 min)", "Temperature (highest)", "Fan"]) {
    const button = system.getByRole("button", { name, exact: true });
    expect(await button.evaluate(element => {
      const style = getComputedStyle(element), parent = getComputedStyle(element.parentElement!);
      return style.color === parent.color && style.fontWeight === parent.fontWeight && style.textDecorationLine === "none";
    })).toBe(true);
    await button.click();
    const chart = system.getByRole("region", { name: `${name} live view`, exact: true });
    await expect(chart.locator(".apexcharts-canvas")).toBeVisible();
    await expect(chart).toContainText("Time (UTC)");
  }
  await system.getByRole("button", { name: "CPU usage", exact: true }).click();
  const chart = system.getByRole("region", { name: "CPU usage live view", exact: true });
  await expect.poll(() => hostReads, { timeout: 12000 }).toBeGreaterThanOrEqual(3);
  await expect.poll(() => chart.locator(".apexcharts-line").first().evaluate(path => (path as SVGPathElement).getTotalLength())).toBeGreaterThan(10);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await system.getByRole("button", { name: "Close live view" }).click();
  await expect(system.locator(".apexcharts-canvas")).toHaveCount(0);
  const counters = page.getByRole("region", { name: "Interface counters", exact: true });
  const interfaceLink = counters.getByRole("link", { name: "eth1", exact: true });
  expect(await interfaceLink.evaluate(element => {
    const style = getComputedStyle(element);
    return style.color === getComputedStyle(element.parentElement!).color && style.textDecorationLine === "none";
  })).toBe(true);
  await interfaceLink.click();
  await expect(page).toHaveURL(/\/diagnostics\/traffic\?interface=eth1$/);
  await expect(page.locator(".v-select").first()).toContainText("eth1");
  await expect(page.getByRole("region", { name: "Bytes", exact: true }).locator(".apexcharts-canvas")).toBeVisible();
  expect(backend.writes).toHaveLength(0);
  expect(errors).toEqual([]);
});
