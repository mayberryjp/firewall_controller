import { expect, test, type Page } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { hostPolicyConfig } from "../fixtures";
import { dnatRule } from "../bgpFixtures";
import { firewallCounters, firewallDenyPage, filteredFirewallDenyPage } from "../firewallTelemetryFixtures";

async function connect(page: Page) {
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("region", { name: "Overview", exact: true })).toBeVisible();
}

test("firewall drop page numbers count server matches and restart on inclusion changes", async ({ page }) => {
  const backend = await mockBackend(page), queries: URLSearchParams[] = [];
  const base = firewallDenyPage().records[0]!;
  const records: typeof base[] = Array.from({ length: 400 }, (_, index) => ({
    ...base, id: String(1000 - index), packet_length: index,
    tags: index < 60 || (index >= 100 && index < 250) || index >= 350 ? ["ipv4_broadcast"] : [],
  }));
  await page.route("**/firewall/deny-log*", route => {
    const params = new URL(route.request().url()).searchParams; queries.push(params);
    return route.fulfill({ json: filteredFirewallDenyPage(records, {
      limit: Number(params.get("limit")), before_id: params.get("before_id") ?? undefined,
      include_broadcast: params.get("include_broadcast") === "true",
      include_tcp_closures: params.get("include_tcp_closures") === "true",
    }) });
  });
  await connect(page); await page.goto("/diagnostics/firewall-drops");
  const view = page.getByRole("region", { name: "Firewall drops", exact: true });
  await expect(view.locator(".drop-row")).toHaveCount(100);
  await expect(view.getByLabel("Firewall drop pages")).toHaveCount(0);
  await view.getByRole("button", { name: "Load older", exact: true }).click();
  await expect(view.locator(".drop-row")).toHaveCount(100);
  await expect(view).toContainText("100 of 140 drops shown");
  await expect(view.getByRole("button", { name: "Load older", exact: true })).toHaveCount(0);
  const pagination = view.getByLabel("Firewall drop pages");
  await expect(pagination).toBeVisible();
  await expect(pagination.getByRole("button", { name: "Go to page 3", exact: true })).toHaveCount(0);
  await pagination.getByRole("button", { name: "Go to page 2", exact: true }).click();
  await expect(view.locator(".drop-row")).toHaveCount(40);
  expect(queries.map(query => [query.get("before_id"), query.get("limit")])).toEqual([
    [null, "100"], ["691", "100"],
  ]);
  expect(queries.every(query => query.get("include_broadcast") === "false" && query.get("include_tcp_closures") === "false")).toBe(true);
  await view.getByRole("checkbox", { name: "Include broadcast drops", exact: true }).check();
  await expect(view.locator(".drop-row")).toHaveCount(100);
  await expect(view.locator('.drop-row [data-label="Bytes"]').first()).toHaveText("0");
  expect(queries[2]!.get("before_id")).toBeNull();
  expect(queries[2]!.get("include_broadcast")).toBe("true");
  for (const count of [200, 300, 400]) {
    await view.getByRole("button", { name: "Load older", exact: true }).click();
    await expect(view).toContainText(`100 of ${count} drops shown`);
  }
  await pagination.getByRole("button", { name: "Go to page 4", exact: true }).click();
  await expect(view.locator(".drop-row")).toHaveCount(100);
  await expect(view.locator('.drop-row [data-label="Bytes"]').first()).toHaveText("300");
  await view.getByRole("checkbox", { name: "Include broadcast drops", exact: true }).uncheck();
  await expect(view.locator(".drop-row")).toHaveCount(100);
  await expect(view.locator('.drop-row [data-label="Bytes"]').first()).toHaveText("60");
  await expect(pagination).toHaveCount(0);
  expect(queries).toHaveLength(7);
  expect(queries[6]!.get("before_id")).toBeNull();
  expect(backend.writes).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("drop inclusion switches request server categories and replace missing-rule totals", async ({ page, isMobile }) => {
  const backend = await mockBackend(page), queries: URLSearchParams[] = [];
  const until = Date.parse("2026-11-08T12:34:56.789Z");
  await page.route("**/firewall/deny-log*", route => {
    const params = new URL(route.request().url()).searchParams; queries.push(params);
    const base = { ...firewallDenyPage().records[0]!, timestamp_ms: until };
    const records: typeof base[] = [
      { ...base, id: "9", tags: ["ipv4_broadcast"] },
      { ...base, id: "8", tags: ["tcp_finish"], tcp_flags: 1 },
      { ...base, id: "7", tags: ["tcp_reset"], tcp_flags: 4 },
      { ...base, id: "6", tags: ["tcp_ack_only"], tcp_flags: 16, tcp_payload_length: 0 },
      { ...base, id: "5", tags: ["tcp_reset", "ipv4_broadcast"], tcp_flags: 4 },
      { ...base, id: "4", tags: ["tcp_connection_attempt"], tcp_flags: 2 },
      { ...base, id: "3", tags: [], tcp_flags: 16, tcp_payload_length: null },
      { ...base, id: "2", tags: [], tcp_flags: 16, tcp_payload_length: 4 },
      { ...base, id: "1", tags: [] },
    ];
    const result = filteredFirewallDenyPage(records, {
      limit: Number(params.get("limit")), before_id: params.get("before_id") ?? undefined,
      since_ms: params.has("since_ms") ? Number(params.get("since_ms")) : undefined,
      until_ms: params.has("until_ms") ? Number(params.get("until_ms")) : undefined,
      include_broadcast: params.get("include_broadcast") === "true",
      include_tcp_closures: params.get("include_tcp_closures") === "true",
    });
    result.capture.status = "disabled";
    return route.fulfill({ json: result });
  });
  await connect(page); await page.clock.setFixedTime(until);
  await page.goto("/diagnostics/firewall-drops");
  const drops = page.getByRole("region", { name: "Firewall drops", exact: true });
  const broadcast = drops.getByRole("checkbox", { name: "Include broadcast drops", exact: true });
  const tcp = drops.getByRole("checkbox", { name: "Include TCP FIN/RST/empty ACK drops", exact: true });
  await expect(broadcast).not.toBeChecked(); await expect(tcp).not.toBeChecked();
  await expect(drops).not.toContainText("Retained input/forward drops only");
  await expect(drops).not.toContainText("Bytes are IP packet lengths, not flow totals");
  await expect(drops.locator(".drop-toolbar .drop-visibility-controls .v-switch")).toHaveCount(2);
  if (!isMobile) {
    const positions = await drops.locator(".drop-visibility-controls").evaluate(toolbar => {
      const timeFilter = toolbar.querySelector('[aria-label="More filters"]')!.getBoundingClientRect();
      return Array.from(toolbar.querySelectorAll(".v-switch")).map(toggle => {
        const bounds = toggle.getBoundingClientRect();
        return { centerOffset: bounds.top + bounds.height / 2 - timeFilter.top - timeFilter.height / 2, afterTimeFilter: bounds.left >= timeFilter.right };
      });
    });
    for (const position of positions) {
      expect(Math.abs(position.centerOffset)).toBeLessThanOrEqual(1);
      expect(position.afterTimeFilter).toBe(true);
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(drops).toContainText("Drop logging is disabled. Existing history is retained");
  await expect(drops.locator(".drop-row")).toHaveCount(4);
  await expect(drops.getByRole("button", { name: "Load older", exact: true })).toHaveCount(0);
  expect(queries).toHaveLength(1);
  await broadcast.check(); await expect(drops.locator(".drop-row")).toHaveCount(5);
  await tcp.check(); await expect(drops.locator(".drop-row")).toHaveCount(9);
  await broadcast.uncheck(); await expect(drops.locator(".drop-row")).toHaveCount(7);
  await tcp.uncheck(); await expect(drops.locator(".drop-row")).toHaveCount(4);
  expect(queries).toHaveLength(5);
  await page.goto("/diagnostics/possible-missing-rules");
  const missing = page.getByRole("region", { name: "Possible missing rules", exact: true });
  const totals = missing.locator(".missing-rules-totals .v-chip");
  const includeBroadcast = missing.getByRole("checkbox", { name: "Include broadcast drops", exact: true });
  const includeTcp = missing.getByRole("checkbox", { name: "Include TCP FIN/RST/empty ACK drops", exact: true });
  await expect(totals).toHaveText(["4 packets", "240 bytes"]);
  await expect(includeBroadcast).not.toBeChecked(); await expect(includeTcp).not.toBeChecked();
  await expect(missing.locator(".missing-rules-toolbar .v-switch")).toHaveCount(2);
  if (!isMobile) {
    const positions = await missing.locator(".missing-rules-toolbar").evaluate(toolbar => {
      const period = toolbar.querySelector(".missing-rules-period")!.getBoundingClientRect();
      return Array.from(toolbar.querySelectorAll(".v-switch")).map(toggle => {
        const bounds = toggle.getBoundingClientRect();
        return { centerOffset: bounds.top + bounds.height / 2 - period.top - period.height / 2, afterDropdown: bounds.left >= period.right };
      });
    });
    for (const position of positions) {
      expect(Math.abs(position.centerOffset)).toBeLessThanOrEqual(1);
      expect(position.afterDropdown).toBe(true);
    }
  }
  await includeBroadcast.check(); await expect(totals).toHaveText(["5 packets", "300 bytes"]);
  await includeTcp.check(); await expect(totals).toHaveText(["9 packets", "540 bytes"]);
  await includeBroadcast.uncheck(); await expect(totals).toHaveText(["7 packets", "420 bytes"]);
  await includeTcp.uncheck(); await expect(totals).toHaveText(["4 packets", "240 bytes"]);
  expect(queries).toHaveLength(10);
  expect(queries.every(params => !params.has("before_id"))).toBe(true);
  expect(queries.map(params => [params.get("include_broadcast"), params.get("include_tcp_closures")])).toEqual([
    ["false", "false"], ["true", "false"], ["true", "true"], ["false", "true"], ["false", "false"],
    ["false", "false"], ["true", "false"], ["true", "true"], ["false", "true"], ["false", "false"],
  ]);
  expect(queries.every(params => !params.has("tag") && !params.has("exclude_tags"))).toBe(true);
  expect(backend.writes).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await expect(includeBroadcast).not.toBeChecked(); await expect(includeTcp).not.toBeChecked();
  await expect(totals).toHaveText(["4 packets", "240 bytes"]);
  await page.goto("/diagnostics/firewall-drops");
  await expect(broadcast).not.toBeChecked(); await expect(tcp).not.toBeChecked();
  await expect(drops.locator(".drop-row")).toHaveCount(4);
});

test("General settings places Spoof Block last and preserves explicit false through reviewed SAVE and confirmation", async ({ page }) => {
  const backend = await mockBackend(page), dialogs: string[] = [];
  page.on("dialog", async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.route("**/*timezones*", route => route.fulfill({ json: { timezones: ["UTC"] } }));
  await connect(page); await page.goto("/settings/general");
  const settings = page.getByRole("region", { name: "General settings", exact: true });
  await expect(settings.locator(".setting-row").last().locator(".setting-name")).toHaveText("Spoof Block");
  const spoof = settings.getByRole("checkbox", { name: "Spoof Block", exact: true });
  await expect(spoof).toBeChecked();
  await spoof.uncheck();
  const logging = settings.getByRole("checkbox", { name: "Log firewall drops", exact: true });
  await expect(logging).toBeChecked();
  await logging.uncheck();
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  expect(backend.writes).toEqual([]); expect(dialogs).toEqual([]);
  await page.getByRole("link", { name: "Save configuration", exact: true }).click();
  await expect(page.getByRole("region", { name: "SAVE", exact: true })).toContainText("Log firewall drops");
  await expect(page.getByRole("region", { name: "SAVE", exact: true })).toContainText("Spoof Block");
  await page.getByRole("button", { name: "Commit & push", exact: true }).click();
  const push = page.getByRole("dialog");
  await expect(push).toContainText("firewall.write");
  await push.getByRole("button", { name: "Push changes", exact: true }).click();
  await expect(push.getByRole("button", { name: "Confirm changes", exact: true })).toBeEnabled();
  expect(backend.writes.find(write => write.path === "/transactions")?.body).toMatchObject({
    config: { firewall: { drop_logging_enabled: false, spoof_block: false } },
  });
  await push.getByRole("button", { name: "Confirm changes", exact: true }).click();
  await expect(push).not.toBeVisible();
  await page.goto("/settings/general");
  await expect(logging).not.toBeChecked();
  await expect(spoof).not.toBeChecked();
  await page.reload();
  await expect(spoof).not.toBeChecked();
  expect(dialogs).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("possible missing rules summarizes all drop pages across time periods and fits compact screens", async ({ page, isMobile }) => {
  const backend = await mockBackend(page);
  const until = Date.parse("2026-11-08T12:34:56.789Z");
  const queries: URLSearchParams[] = [];
  await page.route("**/firewall/deny-log*", route => {
    const params = new URL(route.request().url()).searchParams; queries.push(params);
    const result = firewallDenyPage();
    const older = params.has("before_id");
    result.records = [0, 2, 6, 12, 48, 169].slice(older ? 2 : 0, older ? 6 : 2).map((hours, index) => ({
      ...result.records[0]!, id: String(10 - index - (older ? 2 : 0)),
      timestamp_ms: until - hours * 3600000, source_port: 50000 + index,
      destination_port: 443, ingress: "lab0",
    }));
    result.next_before_id = older ? null : "9";
    return route.fulfill({ json: result });
  });
  await connect(page);
  await page.clock.setFixedTime(until);
  await page.goto("/diagnostics/possible-missing-rules");
  const view = page.getByRole("region", { name: "Possible missing rules", exact: true });
  const navigation = page.getByRole("navigation", { name: "Diagnostics pages", exact: true });
  if (!isMobile) {
    await expect(page.locator(".section-layout")).toHaveClass(/section-layout--collapsed/);
    await expect(navigation.getByRole("tab")).toHaveCount(0);
    expect((await navigation.boundingBox())!.width).toBeLessThanOrEqual(60);
    const expand = navigation.getByRole("button", { name: "Expand Diagnostics navigation", exact: true });
    await expect(expand).toHaveAttribute("aria-expanded", "false");
    await expand.click();
    await expect(page.locator(".section-layout")).not.toHaveClass(/section-layout--collapsed/);
  } else {
    await expect(page.locator(".section-layout")).not.toHaveClass(/section-layout--collapsed/);
    await expect(navigation.getByRole("button", { name: "Expand Diagnostics navigation", exact: true })).toHaveCount(0);
  }
  await expect(navigation.getByRole("tab", { name: "POSSIBLE MISSING RULES", exact: true })).toHaveAttribute("aria-selected", "true");
  const tabs = await navigation.getByRole("tab").allTextContents();
  expect(tabs[tabs.findIndex(title => title.includes("FIREWALL DROPS")) + 1]).toContain("POSSIBLE MISSING RULES");
  if (!isMobile) {
    const collapse = navigation.getByRole("button", { name: "Collapse Diagnostics navigation", exact: true });
    await expect(collapse).toHaveAttribute("aria-expanded", "true");
    await collapse.click();
    await expect(page.locator(".section-layout")).toHaveClass(/section-layout--collapsed/);
    await expect(navigation.getByRole("tab")).toHaveCount(0);
  }
  const table = view.locator(".missing-rules-table");
  await expect(table.locator(".missing-rule-row")).toHaveCount(1);
  await expect(table.locator('[data-label="Packets"]')).toHaveText("1");
  await expect(table.locator('[data-label="Bytes"]')).toHaveText("60");
  await expect(table.locator('[data-label="Ingress"]')).toHaveText("LAB0");
  await expect(table.locator('[data-label="Egress"]')).toHaveText("WAN0");
  await expect(table.locator('[data-label="Protocol"] .v-chip')).toHaveClass(/text-info/);
  await expect(table.locator('[data-label="Destination port"] .v-chip')).toHaveClass(/text-primary/);
  await expect(table.locator('[data-label="Ingress"] .v-chip')).toHaveClass(/text-primary/);
  await expect(table.locator('[data-label="Chain"] .v-chip')).toHaveClass(/text-secondary/);
  await expect(table.locator('[data-label="Reason"] .v-chip')).toHaveClass(/text-error/);
  await expect(table.locator('[data-label="Last seen (UTC)"] time')).toHaveText("2026-11-08 12:34:56");
  await expect(table.locator("time")).toHaveAttribute("datetime", "2026-11-08T12:34:56.789Z");
  await expect(view).not.toContainText("Period (");
  await expect(view).not.toContainText("Captured input/forward drops only");
  await expect(view).not.toContainText("Source ports are ignored");
  await expect(view).not.toContainText("loaded drops shown");
  for (const [period, count] of [["Last 4 hours", "2"], ["Last 8 hours", "3"], ["Last day", "4"], ["Last week", "5"]]) {
    await view.getByRole("combobox", { name: "Time period", exact: true }).press("ArrowDown");
    await page.getByRole("option", { name: period, exact: true }).click();
    await expect(table.locator('[data-label="Packets"]')).toHaveText(count!);
    await expect(table.locator('[data-label="Bytes"]')).toHaveText(String(Number(count) * 60));
  }
  expect(queries).toHaveLength(2);
  expect(queries[1]!.get("before_id")).toBe("9");
  expect(queries.every(params => params.get("since_ms") === String(until - 7 * 86400000) && params.get("until_ms") === String(until))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(backend.writes).toEqual([]);
});

test("firewall drops sorts loaded rows with keyboard-accessible headers on desktop and mobile", async ({ page }) => {
  const backend = await mockBackend(page);
  const queries: URLSearchParams[] = [];
  await page.route("**/firewall/deny-log*", route => {
    const params = new URL(route.request().url()).searchParams; queries.push(params);
    const result = firewallDenyPage(), base = result.records[0]!;
    result.records = params.has("before_id") ? [{ ...base, id: "3", source: "192.0.2.3", packet_length: 100 }] : [
      { ...base, id: "6", source: "192.0.2.10", packet_length: 1000 },
      { ...base, id: "5", source: "192.0.2.2", packet_length: 60 },
      { ...base, id: "4", source: "192.0.2.20", packet_length: 200 },
    ];
    result.next_before_id = params.has("before_id") ? null : "4";
    return route.fulfill({ json: result });
  });
  await connect(page); await page.goto("/diagnostics/firewall-drops");
  const view = page.getByRole("region", { name: "Firewall drops", exact: true });
  const sources = view.locator('.drop-row [data-label="Source / port"] .mono');
  const values = view.locator('.drop-row [data-label="Bytes"]');
  await expect(sources).toHaveText(["192.0.2.10", "192.0.2.2", "192.0.2.20"]);
  const headerBounds = await view.getByRole("columnheader").evaluateAll(headers => headers.map(header => {
    const cell = header.getBoundingClientRect();
    const button = header.querySelector("button")!.getBoundingClientRect();
    return { label: header.textContent?.trim(), left: button.left - cell.left, right: cell.right - button.right };
  }));
  for (const bounds of headerBounds) {
    expect(bounds.left, `${bounds.label} button starts inside its header`).toBeGreaterThanOrEqual(0);
    expect(bounds.right, `${bounds.label} button ends inside its header`).toBeGreaterThanOrEqual(0);
  }
  const sourceHeader = view.getByRole("columnheader", { name: "Source / port", exact: true });
  await sourceHeader.getByRole("button").press("Enter");
  await expect(sourceHeader).toHaveAttribute("aria-sort", "ascending");
  await expect(sources).toHaveText(["192.0.2.2", "192.0.2.10", "192.0.2.20"]);
  expect(queries).toHaveLength(1);
  const bytesHeader = view.getByRole("columnheader", { name: "Bytes", exact: true });
  await bytesHeader.getByRole("button").click();
  await expect(bytesHeader).toHaveAttribute("aria-sort", "ascending");
  await expect(values).toHaveText(["60", "200", "1000"]);
  await bytesHeader.getByRole("button").press("Enter");
  await expect(bytesHeader).toHaveAttribute("aria-sort", "descending");
  await expect(values).toHaveText(["1000", "200", "60"]);
  await view.getByRole("button", { name: "Load older", exact: true }).click();
  await expect(values).toHaveText(["1000", "200", "100", "60"]);
  expect(queries.at(-1)!.get("before_id")).toBe("4");
  await view.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(values).toHaveText(["1000", "200", "60"]);
  await expect(bytesHeader).toHaveAttribute("aria-sort", "descending");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(backend.writes).toEqual([]);
});

test("DHCP relay rules show full matches only on their configured interfaces", async ({ page }) => {
  const settings = hostPolicyConfig();
  const link = settings.interfaces[0]!;
  link.dhcp_relay = { enabled: true, servers: ["198.51.100.40"] };
  settings.interfaces.unshift({ ...link, name: "vlan30", addresses: ["192.0.30.1/24"] });
  settings.interfaces.push({ ...link, name: "wan0", dhcp_relay: { enabled: false, servers: [] } });
  settings.firewall.input = { policy: "drop", interfaces: [{ interface: "lab0", rules: [{ action: "drop" }] }] };
  const backend = await mockBackend(page, { initialConfig: settings });
  await page.route("**/statistics/firewall", route => route.fulfill({ json: firewallCounters(settings) }));
  await connect(page);
  await page.goto("/firewall/input");
  const table = page.getByRole("table", { name: "Input rules", exact: true });
  const rows = table.locator('.rule-section--system .system-rule[title^="DHCP relay"]');
  await expect(rows).toHaveCount(2);
  await expect(rows.first().locator(".rule-value")).toHaveText([
    "DHCP clients", "LAB0", "Any IPv4", "192.0.2.10/32, 255.255.255.255/32", "UDP", "68", "67", "accept",
  ]);
  await expect(rows.nth(1).locator(".rule-value")).toHaveText([
    "DHCP servers", "Any", "198.51.100.40/32", "192.0.2.10/32", "UDP", "67", "67", "accept",
  ]);
  await expect(table.locator(".counter-summary")).toHaveCount(0);
  await expect(rows.locator(".rule-origin")).toHaveText(["System", "System"]);
  await expect(rows.first().locator(".counter-value")).toHaveText(["9007199254740993", "18446744073709551616"]);
  await expect(rows.nth(1).locator(".counter-value").first()).toHaveText("0");
  await expect(rows.locator("button, input, select, [data-rule-index]")).toHaveCount(0);
  await expect(table.locator(".rule-section--user .host-rule")).toHaveAttribute("data-action", "drop");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("combobox", { name: "Interface", exact: true }).press("ArrowDown");
  await page.getByRole("option", { name: /^VLAN30/ }).click();
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("192.0.30.1/32");
  await expect(rows.nth(1)).toContainText("192.0.30.1/32");
  await expect(rows.first()).not.toContainText("192.0.2.10/32");
  await page.getByRole("combobox", { name: "Interface", exact: true }).press("ArrowDown");
  await page.getByRole("option", { name: /^WAN0/ }).click();
  await expect(rows).toHaveCount(0);
  expect(backend.writes).toEqual([]);
});

test("drop history gives endpoint labels the available desktop space", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop table layout");
  await page.setViewportSize({ width: 1830, height: 900 });
  const config = hostPolicyConfig();
  config.firewall.policies!.hosts[0]!.metadata = { display_name: "Modan-registry container", description: "" };
  config.firewall.policies!.hosts[1]!.metadata = { display_name: "Mirena container", description: "" };
  await mockBackend(page, { initialConfig: config });
  const drops = firewallDenyPage();
  drops.records[0]!.source_port = 65535;
  drops.records[0]!.destination_port = 65535;
  await page.route("**/firewall/deny-log*", route => route.fulfill({ json: drops }));
  await connect(page); await page.goto("/diagnostics/firewall-drops");
  const row = page.locator(".drop-row").first();
  await expect(row).toBeVisible();
  await expect(row.locator(".drop-endpoint .mono")).toHaveCount(2);
  const measurements = await row.locator(".drop-endpoint").evaluateAll(cells => cells.map(cell => {
    const text = cell.querySelector<HTMLElement>(".mono")!;
    const port = cell.querySelector<HTMLElement>(".v-chip")!;
    const cellBounds = cell.getBoundingClientRect(), portBounds = port.getBoundingClientRect();
    return {
      textWidth: text.clientWidth,
      truncated: text.scrollWidth > text.clientWidth,
      portWidth: portBounds.width,
      portContained: portBounds.right <= cellBounds.right,
    };
  }));
  for (const measurement of measurements) {
    expect(measurement.textWidth).toBeGreaterThan(300);
    expect(measurement.truncated).toBe(false);
    expect(measurement.portWidth).toBeLessThan(60);
    expect(measurement.portContained).toBe(true);
  }
  const bytesWidth = await row.locator('[data-label="Bytes"]').evaluate(cell => cell.getBoundingClientRect().width);
  expect(bytesWidth).toBeLessThan(85);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("drop history supports UTC filters, exact cursors and compact screens without details or writes", async ({ page }, testInfo) => {
  const backend = await mockBackend(page);
  const queries: URLSearchParams[] = [];
  await page.route("**/firewall/deny-log*", route => {
    const url = new URL(route.request().url()); queries.push(url.searchParams);
    const response = firewallDenyPage();
    if (url.searchParams.has("before_id")) {
      response.records[0]!.id = "18446744073709551613"; response.next_before_id = null; response.cursor_expired = true;
    }
    return route.fulfill({ json: response });
  });
  await connect(page); await page.goto("/diagnostics/firewall-drops");
  const view = page.getByRole("region", { name: "Firewall drops", exact: true });
  const navigation = page.getByRole("navigation", { name: "Diagnostics pages", exact: true });
  if (testInfo.project.name === "chromium") {
    await expect(page.locator(".section-layout")).toHaveClass(/section-layout--collapsed/);
    await expect(navigation.getByRole("tab")).toHaveCount(0);
    await navigation.getByRole("button", { name: "Expand Diagnostics navigation", exact: true }).click();
    await expect(navigation.getByRole("tab", { name: "FIREWALL DROPS", exact: true })).toHaveAttribute("aria-selected", "true");
    await navigation.getByRole("button", { name: "Collapse Diagnostics navigation", exact: true }).click();
  } else {
    await expect(navigation.getByRole("tab", { name: "FIREWALL DROPS", exact: true })).toBeVisible();
  }
  await expect(view.locator("h1")).toHaveCount(0);
  await expect(view.locator("time")).toHaveText("2026-10-30 12:34:56");
  await expect(view.locator("time")).toHaveAttribute("datetime", "2026-10-30T12:34:56.789Z");
  await expect(view.locator(".drop-table thead th")).toHaveText([
    "Time (UTC)", "Source / port", "Destination / port", "Protocol", "Ingress", "Egress", "Bytes", "Reason",
  ]);
  await expect(view.locator(".drop-row td")).toHaveCount(8);
  await expect(view.getByRole("button", { name: /^Details for drop / })).toHaveCount(0);
  await expect(view.locator(".drop-details")).toHaveCount(0);
  await expect(view.locator('[data-label="Ingress"]')).toHaveText("—");
  await expect(view.locator('[title="Source port 0"]')).toHaveText("0");
  await expect(view.locator('[data-label="Protocol"] .v-chip')).toHaveClass(/text-info/);
  await expect(view.locator('[data-label="Reason"] .v-chip').last()).toHaveClass(/text-error/);
  await expect(view.getByLabel("Since (UTC)")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("firewall-drops.png"), fullPage: true });
  await view.getByRole("button", { name: "Load older", exact: true }).click();
  await expect(view.locator("time")).toHaveCount(2);
  expect(queries.at(-1)!.get("before_id")).toBe("18446744073709551614");
  await expect(view).toContainText("Retention gap");
  await view.getByLabel("Source or destination IP").fill("192.0.2.20");
  await view.getByLabel("IP protocol (0–255)").fill("6");
  await view.getByRole("button", { name: "More filters", exact: true }).click();
  await expect(view.getByRole("button", { name: "More filters", exact: true })).toHaveAttribute("aria-expanded", "true");
  await view.getByLabel("Since (UTC)").fill("2026-10-30 00:00:00");
  await view.getByRole("button", { name: "Apply filters", exact: true }).click();
  await expect(view.locator("time")).toHaveCount(1);
  expect(Object.fromEntries(queries.at(-1)!)).toMatchObject({ address: "192.0.2.20", protocol: "6", since_ms: String(Date.parse("2026-10-30T00:00:00Z")) });
  expect(queries.at(-1)!.has("before_id")).toBe(false); expect(backend.writes).toEqual([]);
});

test("applied host, interface, input and NAT rule counters preserve exact totals and fit compact screens", async ({ page, isMobile }, testInfo) => {
  const settings = hostPolicyConfig();
  settings.firewall.policies!.hosts[2]!.addresses.push("2001:db8::30");
  settings.interfaces.push({ ...settings.interfaces[0]!, name: "wan0", role: "wan", addresses: ["203.0.113.1/24"] });
  settings.firewall.input = { policy: "drop", interfaces: [{ interface: "lab0", rules: [{ protocol: "tcp", destination_ports: [443], action: "accept" }] }] };
  settings.firewall.nat.destination_rewrite = [dnatRule()];
  const backend = await mockBackend(page, { initialConfig: settings });
  const sample = firewallCounters(settings);
  await page.route("**/statistics/firewall", route => route.fulfill({ json: sample }));
  await connect(page);
  for (const path of ["/firewall", "/firewall/ingress", "/firewall/input", "/firewall/nat", "/firewall/nat/dnat"]) {
    await page.goto(path);
    await expect(page.locator(".counter-value").filter({ hasText: /^9007199254740993$/ }).first()).toBeVisible();
    await expect(page.locator(".counter-value").filter({ hasText: /^18446744073709551616$/ }).first()).toBeVisible();
    await expect(page.locator(".app-content")).toContainText("Sampled (UTC): 2026-10-30 12:34:56");
    if (["/firewall", "/firewall/ingress", "/firewall/input"].includes(path)) {
      const system = page.locator(".host-rules-table");
      await expect(system).toHaveCount(1);
      await expect(system.locator("thead")).toHaveCount(1);
      await expect(system.locator(".rule-section-heading")).toHaveText(path === "/firewall"
        ? ["System Rules", "Interface Overrides", "Host Rules", "Default Rules"] : ["System Rules", "User Rules", "Default Rules"]);
      if (path === "/firewall") {
        await expect(system.getByRole("columnheader", { name: "Ingress", exact: true })).toBeVisible();
        await expect(system.locator(".interface-rule .rule-value--ingress")).toHaveText(["LAB0"]);
        await expect(system.locator(".interface-rule").locator("button, input, select")).toHaveCount(0);
        await expect(system.locator(".system-rule--default .rule-value--order")).toHaveText("Global");
      }
      await expect(system).toBeVisible();
      await expect(system.locator(".system-rule")).toHaveCount(path === "/firewall/input" ? 4 : 3);
      await expect(system.locator(".system-rule").locator("button, input, select, td > div.text-caption")).toHaveCount(0);
      await expect(system.locator(".system-rule").first()).toContainText("ICMP");
      await expect(system.locator(".system-rule").first()).toContainText("accept");
      await expect(system.locator(".system-rule--default .counter-value").first()).toHaveText("0");
      await expect(page.locator(".host-rules-table .counter-summary")).toHaveCount(0);
      if (path === "/firewall/input") {
        await expect(system.locator(".system-rule").nth(1)).toHaveAttribute("title", /Ingress: lo/);
        await expect(system.locator(".system-rule").nth(2)).toHaveAttribute("title", /Connection state: established, related/);
        await expect(system.locator(".system-rule--default")).toHaveAttribute("data-action", "drop");
      }
    }
    if (!isMobile && ["/firewall", "/firewall/ingress", "/firewall/input"].includes(path)) {
      const row = page.locator(".host-rule").first();
      await expect(row).toHaveCSS("display", "table-row");
      await expect(row.locator(".counter-label").first()).toBeHidden();
      for (const rule of await page.locator(".host-rule, .system-rule, .interface-rule").all()) {
        expect((await rule.boundingBox())!.height, `${path}: ${await rule.locator(".rule-value").first().innerText()}`).toBeLessThanOrEqual(44);
        await expect(rule.locator(".rule-value").first()).toHaveCSS("white-space", "nowrap");
        await expect(rule.locator(".rule-action .v-chip__content")).toHaveCSS("white-space", "nowrap");
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`counters-${path.split("/").filter(Boolean).join("-")}.png`), fullPage: true });
  }
  await page.goto("/firewall");
  await page.getByRole("navigation", { name: "Hosts", exact: true }).getByRole("button", { name: "WORKSTATION (192.0.2.20)", exact: true }).click();
  await page.getByRole("button", { name: "Drag rule 1", exact: true }).hover();
  await page.mouse.down();
  const destination = page.locator('[data-rule-index="1"] .rule-value--order');
  await destination.scrollIntoViewIfNeeded();
  const end = await destination.boundingBox();
  await page.mouse.move(end!.x + end!.width / 2, end!.y + end!.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator(".host-policy-content [role='alert']")).toHaveCount(0);
  await expect(page.locator(".host-rule .counter-value").first()).toHaveText("—");
  await expect(page.locator(".app-content")).toContainText("unapplied firewall edits");
  expect(backend.writes).toEqual([]);
});

test("drop permission and unsupported telemetry errors are actionable rather than healthy empty results", async ({ page }) => {
  await mockBackend(page);
  await page.route("**/firewall/deny-log*", route => route.fulfill({ status: 403, json: { error: "Forbidden" } }));
  await connect(page); await page.goto("/diagnostics/firewall-drops");
  await expect(page.getByRole("alert")).toContainText("firewall.logs.read");
  await expect(page.getByText("No retained drops match these filters.")).toHaveCount(0);
  await page.unroute("**/firewall/deny-log*");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("unavailable");
});
