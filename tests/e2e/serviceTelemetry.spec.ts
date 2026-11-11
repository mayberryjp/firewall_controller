import { expect, test, type Page } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { config, runtime } from "../fixtures";
import { relayStatistics, relayLog, persistentLog } from "../serviceTelemetryFixtures";
import { interfaceCapabilitySnapshot } from "../diagnosticsFixtures";

async function connect(page: Page) {
  const initialConfig = config();
  initialConfig.syslog = { enabled: true, servers: [
    { host: "logs.example", port: 514, transport: "udp" },
    { host: "backup.example", port: 6514, transport: "tls" },
  ] };
  await mockBackend(page, { initialConfig });
  await page.route("**/api/v1/**", async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (path.endsWith("/statistics/dhcp-relay")) return route.fulfill({ json: relayStatistics() });
    if (path.endsWith("/runtime")) return route.fulfill({ json: {
      ...runtime(), softflowd: [{ name: "capture", state: "running", exported_flows: 30, exported_packets: "1" }],
      appliance_services: [{
        name: "syslog", scope: "host", state: "running", forwarding_enabled: true,
        received_records: 10, forwarded_deliveries: 1,
      }],
    } });
    if (path.endsWith("/services/dhcp-relay/log")) {
      const result = relayLog();
      if (url.searchParams.has("cursor")) result.events = [];
      return route.fulfill({ json: result });
    }
    if (path.endsWith("/logs/syslog") || path.endsWith("/logs/netcontrol")) {
      const result = persistentLog(path.endsWith("/logs/syslog") ? "syslog" : "netcontrol");
      if (url.searchParams.has("cursor")) result.entries = [];
      return route.fulfill({ json: result });
    }
    if (path.endsWith("/interface-capabilities")) return route.fulfill({ json: interfaceCapabilitySnapshot() });
    return route.fallback();
  });
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("region", { name: "Overview", exact: true })).toBeVisible();
}

test("DHCP counters stay in the existing compact relay rows", async ({ page }, testInfo) => {
  await connect(page); await page.goto("/services/dhcp-relay");
  const table = page.locator(".relay-table");
  await expect(table.locator("thead th")).toHaveText(["Interface", "Servers", "Status", "Enabled", "Requests forwarded", "Replies received", "Actions"]);
  await expect(table.locator("tbody tr").first().locator("td").nth(4)).toHaveText("3");
  await expect(table.locator("tbody tr").first().locator("td").nth(5)).toHaveText("2");
  await expect(page.getByRole("region", { name: "DHCPv4 relay", exact: true }).locator("table")).toHaveCount(1);
  const interfaceCell = await table.locator("tbody tr").first().locator("td").first().boundingBox();
  expect(interfaceCell!.width).toBeLessThan(280);
  const widths = await table.locator("thead th").evaluateAll(headers =>
    headers.slice(0, 6).map(header => header.getBoundingClientRect().width));
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("dhcp-inline-counters.png"), fullPage: true, animations: "disabled" });
});

test("Syslog uses two shared counter columns in the server table", async ({ page }, testInfo) => {
  await connect(page); await page.goto("/services/syslog");
  const table = page.locator(".service-table");
  await expect(table.locator("thead th")).toHaveText(["Host", "Port", "Transport", "Logs read", "Remote sends", "Actions"]);
  await expect(table.locator("tbody tr").first().locator("td").nth(3)).toHaveText("10");
  await expect(table.locator("tbody tr").first().locator("td").nth(4)).toHaveText("1");
  await expect(table.locator("tbody tr").first().locator("td").nth(3)).toHaveAttribute("rowspan", "2");
  await expect(page.getByRole("region", { name: "Syslog", exact: true }).locator("table")).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("syslog-inline-counters.png"), fullPage: true, animations: "disabled" });
});

test("new diagnostics are reachable and log streams remain separate", async ({ page }) => {
  await connect(page); await page.goto("/diagnostics/dhcp-relay-logs");
  await expect(page.getByRole("heading", { name: "DHCP relay logs", exact: true })).toBeVisible();
  await expect(page.getByText("Request forwarded", { exact: true })).toBeVisible();
  await page.goto("/diagnostics/syslog");
  await expect(page.getByText("syslog entry 1", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Netcontrol", exact: true }).click();
  await expect(page.getByText("netcontrol entry 1", { exact: true })).toBeVisible();
  await expect(page.getByText("syslog entry 1", { exact: true })).toBeHidden();
  await page.goto("/diagnostics/rss-irq");
  await expect(page.getByRole("heading", { name: "RSS / IRQ", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "RX queue targets", exact: true }).first()).toBeVisible();
});

test("NetFlow adds just two counters to the existing export rows", async ({ page }, testInfo) => {
  await connect(page); await page.goto("/services/netflow");
  const table = page.locator(".compact-interface-table");
  await expect(table.locator("thead th")).toContainText(["Flow records", "Export datagrams"]);
  const row = table.locator("tbody tr").first();
  await expect(row.locator("td").nth(7)).toContainText("30");
  await expect(row.locator("td").nth(8)).toContainText("1");
  await expect(page.getByRole("region", { name: "NetFlow/IPFIX", exact: true }).locator("table")).toHaveCount(1);
  if (testInfo.project.name === "chromium") {
    const nameColumn = await table.locator("th.column-name").boundingBox();
    expect(nameColumn!.width).toBeLessThanOrEqual(104);
  }
  await page.screenshot({ path: testInfo.outputPath("netflow-inline-counters.png"), fullPage: true, animations: "disabled" });
});

test("both persistent log tabs keep timestamps narrow with long messages", async ({ page }, testInfo) => {
  await connect(page);
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (!path.endsWith("/logs/syslog") && !path.endsWith("/logs/netcontrol")) return route.fallback();
    const result = persistentLog(path.endsWith("/logs/syslog") ? "syslog" : "netcontrol");
    result.entries[0]!.message = "A long diagnostic record with opaque fields and driver details. ".repeat(20);
    return route.fulfill({ json: result });
  });
  await page.goto("/diagnostics/syslog");
  for (const name of ["Syslog", "Netcontrol"]) {
    const panel = page.locator(name === "Syslog" ? "#syslog-panel" : "#netcontrol-panel");
    if (name === "Netcontrol") await page.getByRole("tab", { name, exact: true }).click();
    await expect(panel.locator("time")).toBeVisible();
    const timestamp = await panel.locator("td.log-time").boundingBox();
    const text = await panel.locator("time").boundingBox();
    const message = await panel.locator("td.log-message").boundingBox();
    expect(timestamp!.width).toBeLessThanOrEqual(180);
    expect(message!.x - (text!.x + text!.width)).toBeLessThan(60);
    expect(text!.width).toBeLessThan(timestamp!.width);
  }
  await page.screenshot({ path: testInfo.outputPath("compact-log-timestamps.png"), fullPage: true, animations: "disabled" });
});

test("RSS/IRQ navigation hides all-unsupported interfaces even in a partial snapshot", async ({ page }) => {
  await connect(page);
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (!path.endsWith("/interface-capabilities") && !path.endsWith("/interface-capabilities/refresh")) return route.fallback();
    const snapshot = interfaceCapabilitySnapshot();
    snapshot.inventory.status = "partial";
    snapshot.inventory.interfaces[0]!.capabilities.find(feature => feature.name === "rss")!.support = "unsupported";
    return route.fulfill({ json: snapshot });
  });
  await page.goto("/diagnostics/rss-irq");
  await expect(page.getByRole("heading", { name: "RSS / IRQ", exact: true })).toBeVisible();
  await expect(page.getByText("Not supported", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Diagnostics pages", exact: true }).getByRole("tab", { name: "RSS / IRQ", exact: true })).toHaveCount(0);
  await page.route("**/api/v1/**", async route => {
    if (!new URL(route.request().url()).pathname.endsWith("/interface-capabilities/refresh")) return route.fallback();
    const snapshot = interfaceCapabilitySnapshot();
    for (const row of snapshot.inventory.interfaces) {
      const rss = row.capabilities.find(feature => feature.name === "rss")!;
      rss.support = "unknown"; rss.enabled = null;
    }
    return route.fulfill({ json: snapshot });
  });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText("Not supported", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Diagnostics pages", exact: true }).getByRole("tab", { name: "RSS / IRQ", exact: true })).toHaveCount(0);
  await page.route("**/api/v1/**", async route => {
    if (!new URL(route.request().url()).pathname.endsWith("/interface-capabilities/refresh")) return route.fallback();
    const snapshot = interfaceCapabilitySnapshot();
    snapshot.inventory.interfaces[0]!.capabilities.find(feature => feature.name === "rss")!.enabled = true;
    return route.fulfill({ json: snapshot });
  });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Diagnostics pages", exact: true }).getByRole("tab", { name: "RSS / IRQ", exact: true })).toHaveCount(1);
  await page.route("**/api/v1/**", async route => {
    if (!new URL(route.request().url()).pathname.endsWith("/interface-capabilities/refresh")) return route.fallback();
    return route.fulfill({ status: 503, json: { error: "Scan unavailable" } });
  });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Diagnostics pages", exact: true }).getByRole("tab", { name: "RSS / IRQ", exact: true })).toHaveCount(1);
});
