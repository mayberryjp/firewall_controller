import { expect, test } from "@playwright/test";
import { connections, hostPolicyConfig } from "../fixtures";
import { mockBackend } from "./mockBackend";

test("connections prioritize endpoint space while keeping counters and ports visible", async ({ page, isMobile }) => {
  if (!isMobile) await page.setViewportSize({ width: 1830, height: 900 });
  const config = hostPolicyConfig();
  config.firewall.policies!.hosts[0]!.metadata = { display_name: "Uptimekuma container", description: "" };
  config.firewall.policies!.hosts[1]!.metadata = { display_name: "Modan-registry container", description: "" };
  const backend = await mockBackend(page, { initialConfig: config });
  const sample = connections(), row = sample.connections[0]!;
  row.original.source = "192.0.2.20";
  row.original.destination = "198.51.100.10";
  row.original.destination_port = 65535;
  row.reply_counters = { packets: "1234567890123456", bytes: "18446744073709551615" };
  await page.route("**/statistics/connections*", route => route.fulfill({ json: sample }));
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("region", { name: "Overview", exact: true })).toBeVisible();
  await page.goto("/connections");
  const view = page.getByRole("region", { name: "Connections", exact: true });
  const displayedRow = view.locator(".connection-row").first();
  await expect(displayedRow).toBeVisible();
  await expect(displayedRow.locator('[data-label="Received packets"]')).toHaveText("1234567890123456");
  await expect(displayedRow.locator('[data-label="Received bytes"]')).toHaveAttribute("title", "18446744073709551615 bytes");
  const endpoints = await displayedRow.locator(".endpoint").evaluateAll(cells => cells.map(cell => {
    const text = cell.querySelector<HTMLElement>(".mono")!;
    const chip = cell.querySelector<HTMLElement>(".v-chip");
    const cellBounds = cell.getBoundingClientRect();
    const chipBounds = chip?.getBoundingClientRect();
    return {
      width: text.clientWidth,
      truncated: text.scrollWidth > text.clientWidth,
      portContained: !chipBounds || (chipBounds.left >= cellBounds.left && chipBounds.right <= cellBounds.right + 1),
    };
  }));
  expect(endpoints).toHaveLength(2);
  for (const endpoint of endpoints) {
    expect(endpoint.portContained).toBe(true);
    if (!isMobile) {
      expect(endpoint.width).toBeGreaterThan(250);
      expect(endpoint.truncated).toBe(false);
    }
  }
  if (!isMobile) {
    const widths = await displayedRow.locator(".connection-protocol-cell, .connection-number").evaluateAll(cells =>
      cells.map(cell => cell.getBoundingClientRect().width));
    for (const width of widths) expect(width).toBeLessThan(160);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(backend.writes).toEqual([]);
});
