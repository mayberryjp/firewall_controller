import { expect, test, type Page } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { config, gatewayStatistics, monitor, statistics, connections, healthSnapshot } from "../fixtures";
import { navigationSections } from "../../src/constants/navigation";

async function signInToRegistry(page: Page): Promise<void> {
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Test firewall", exact: true })).toBeVisible();
}
async function connect(page: Page): Promise<void> {
  await page.goto("/connect");
  await signInToRegistry(page);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
}
async function openNavigation(page: Page): Promise<void> {
  const hamburger = page.getByRole("button", { name: "Open navigation menu", exact: true });
  if (await hamburger.isVisible() && await hamburger.getAttribute("aria-expanded") !== "true") {
    await hamburger.click();
  }
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
}

test("consolidated health issues stay compact and never interrupt configuration", async ({ page }, testInfo) => {
  await page.clock.install();
  const backend = await mockBackend(page);
  const timestamp = "2026-10-27T01:02:03.987Z";
  const alert = { id: "ntp:upstream", component: "appliance_services", resource: "ntp", severity: "warning", code: "future_condition", message: "NTP upstream samples unavailable", retrying: false, first_seen_at: timestamp, last_seen_at: timestamp };
  let alerts = [alert, alert];
  await page.route("**/proxy/platform/status", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    process_health: { status: "healthy", healthy: true, collected_at: timestamp, stale: false,
      components: [{ id: "ntp", component: "appliance_services", resource: "ntp", state: "running", healthy: true, retrying: false, collected_at: timestamp }] },
    active_alerts: alerts,
  }) }));
  await connect(page);
  const bubble = page.locator(".connection-bubble");
  const panel = page.getByRole("region", { name: "Health and issues", exact: true });
  await expect(bubble).toHaveAttribute("aria-label", "Issues");
  await expect(panel).not.toBeVisible();
  await expect(bubble).toHaveText("");
  const size = await bubble.boundingBox();
  expect(size?.width).toBe(40); expect(size?.height).toBe(40);
  await expect(page.locator("main .v-alert")).toHaveCount(0);
  await bubble.click();
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("list", { name: "Active alerts" }).locator("li")).toHaveCount(1);
  await expect(panel).toContainText("Process health: Healthy");
  await expect(panel).toContainText("First seen (UTC): 2026-10-27 01:02:03");
  await expect(panel.locator(".v-alert")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("consolidated-health-issues.png"), fullPage: true, animations: "disabled" });
  alerts = [];
  await page.clock.fastForward(3500);
  await expect(panel.getByRole("list", { name: "Active alerts" })).toHaveCount(0);
  await expect(panel).toContainText("No active alerts.");
  await page.keyboard.press("Escape");
  await expect(panel).not.toBeVisible();
  await page.goto("/services/syslog");
  await expect(page.getByRole("button", { name: "Add remote syslog server", exact: true })).toBeEnabled();
  await expect(page.locator("main .v-alert")).toHaveCount(0);
  expect(backend.writes).toHaveLength(0);
});

test("overview packet counters abbreviate totals and show exact poll changes", async ({ page }, testInfo) => {
  await page.clock.install();
  await mockBackend(page);
  let tick = 0;
  await page.route("**/proxy/statistics", route => {
    const sample = statistics();
    sample.sample.status = "available";
    sample.sample.collected_at = new Date(Date.UTC(2026, 9, 25, 12, 0, tick * 3)).toISOString();
    sample.interfaces[0] = {
      ...sample.interfaces[0]!, status: "available",
      counters: { rx_packets: String(99999 + tick * 50), tx_packets: String(1234567 + tick * 100000) },
    };
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(sample) });
  });
  await connect(page);
  const counters = page.getByRole("region", { name: "Interface counters", exact: true });
  const cells = counters.locator("tbody tr").first().locator("td");
  await expect(cells.nth(0)).toHaveText("99,999");
  await expect(cells.nth(1)).toHaveText("1.23M");
  await expect(counters.locator(".v-chip")).toHaveCount(0);
  tick++;
  await page.clock.fastForward(3500);
  await expect(cells.nth(0).locator(".counter-value > span:first-child")).toHaveText("100.05K");
  await expect(cells.nth(0)).toHaveAttribute("title", "100049");
  await expect(cells.nth(0).locator(".v-chip")).toHaveText("+50");
  await expect(cells.nth(1).locator(".v-chip")).toHaveText("+100.00K");
  await expect(cells.nth(1).locator(".v-chip")).toHaveAttribute("title", "+100,000 packets since previous poll");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("packet-poll-changes.png"), fullPage: true, animations: "disabled" });
});

test("overview layout supports moving, hiding, restoring and registry persistence", async ({ page, isMobile }, testInfo) => {
  const backend = await mockBackend(page);
  await connect(page);
  const customize = page.getByRole("button", { name: "Customize layout", exact: true });
  await customize.click();
  await page.getByRole("button", { name: "Move Gateways up", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-column="0"] [data-widget]').first()).toHaveAttribute("data-widget", "gateways");
  if (!isMobile) {
    await page.getByRole("button", { name: "Drag System stats", exact: true }).dragTo(page.locator('[data-widget="gateways"]'));
  } else {
    await page.getByRole("button", { name: "Move System stats to left column", exact: true }).click();
    await page.getByRole("button", { name: "Move System stats up", exact: true }).click();
    await page.getByRole("button", { name: "Move System stats up", exact: true }).click();
    await page.getByRole("button", { name: "Move System stats up", exact: true }).click();
  }
  await expect(page.locator('[data-column="0"] [data-widget]').first()).toHaveAttribute("data-widget", "system");
  await page.getByRole("button", { name: "Hide WireGuard", exact: true }).click();
  await expect(page.locator('[data-widget="wireguard"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("customize-overview.png"), fullPage: true, animations: "disabled" });
  let failSave = true;
  await page.route("**/api/v1/preferences/overview", route => {
    if (route.request().method() === "POST" && failSave) {
      return route.fulfill({ status: 503, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: "Registry storage is unavailable" }) });
    }
    return route.fallback();
  });
  await page.getByRole("button", { name: "Save layout", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Could not save the overview layout.");
  await expect(page.getByRole("button", { name: "Show WireGuard", exact: true })).toBeVisible();
  failSave = false;
  await page.getByRole("button", { name: "Save layout", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Overview layout saved to the registry.");
  await page.reload();
  await expect(customize).toBeEnabled();
  await expect(page.locator('[data-column="0"] [data-widget]').first()).toHaveAttribute("data-widget", "system");
  await expect(page.locator('[data-widget="wireguard"]')).toHaveCount(0);
  await customize.click();
  await page.getByRole("button", { name: "Show WireGuard", exact: true }).click();
  await expect(page.locator('[data-widget="wireguard"]')).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator('[data-widget="wireguard"]')).toHaveCount(0);
  await customize.click();
  await page.getByRole("button", { name: "Reset layout", exact: true }).click();
  await page.getByRole("button", { name: "Save layout", exact: true }).click();
  await expect(customize).toBeEnabled();
  await page.reload();
  await expect(page.locator("[data-widget]")).toHaveCount(5);
  await expect(page.locator('[data-column="0"] [data-widget]').first()).toHaveAttribute("data-widget", "interfaces");
  expect(backend.writes).toHaveLength(0);
});

test("Home Assistant MQTT configuration and system stats use the staged confirmed workflow", async ({ page }, testInfo) => {
  await page.clock.install();
  const backend = await mockBackend(page), errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  let hostReads = 0;
  await page.route("**/proxy/statistics/host", route => {
    const index = hostReads++;
    return route.fulfill({ contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(healthSnapshot(String(9007199254740993n + BigInt(index) * 25n), String(9007199254740993n + BigInt(index) * 75n), 100 + index * 3)) });
  });
  await connect(page);
  const system = page.getByRole("region", { name: "System stats", exact: true });
  await expect(system.getByRole("row", { name: /Memory/ })).toContainText("6 GB / 8 GB");
  await page.clock.fastForward(3500);
  await expect(system.getByRole("row", { name: /CPU usage/ })).toContainText("25 %");
  await expect(system.getByRole("row", { name: /Root filesystem/ }).locator(".v-chip")).toHaveClass(/text-error/);
  expect(await system.locator(".v-table__wrapper").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("overview-system-stats.png"), fullPage: true, animations: "disabled" });
  await navigate(page, "MQTT STREAMING");
  const reads = hostReads; await page.clock.fastForward(9000); expect(hostReads).toBe(reads);
  const settings = page.getByRole("region", { name: "MQTT STREAMING settings", exact: true });
  await settings.getByLabel("Enable MQTT", { exact: true }).check();
  await settings.getByLabel("Broker URL", { exact: true }).fill("mqtts://broker.example.test:8883");
  await settings.getByLabel("Source interface", { exact: true }).press("Enter");
  await page.getByRole("option", { name: "lab0", exact: true }).click();
  await settings.getByLabel("Username", { exact: true }).fill("publisher");
  const password = settings.getByLabel("Replacement password", { exact: true });
  await expect(password).toHaveAttribute("type", "password"); await password.fill("synthetic-mqtt-password");
  await settings.getByLabel("Publish interval (seconds)", { exact: true }).fill("30");
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await expect(password).toHaveValue(""); await expect(settings).toContainText("Stored password configured");
  expect(backend.writes.map(item => item.path)).toEqual(["/services/mqtt/passwords"]);
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  expect(backend.writes).toHaveLength(1);
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain("synthetic-mqtt-password");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); window.scrollTo(0, 0); });
  await page.clock.runFor(300);
  await page.screenshot({ path: testInfo.outputPath("home-assistant-settings.png"), fullPage: true, animations: "disabled" });
  await navigate(page, "SAVE"); await expect(page.getByRole("main")).toContainText("mqtt");
  await expect(page.getByRole("main")).not.toContainText("synthetic-mqtt-password");
  await page.getByRole("button", { name: "Commit & push", exact: true }).click();
  await page.getByRole("button", { name: "Push changes", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Confirm changes", exact: true })).toBeEnabled();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm changes", exact: true }).click();
  await expect(page).toHaveURL(/\/config\/commits\/tx-test$/);
  const candidate = backend.writes.find(item => item.path === "/transactions")!.body as { config: ReturnType<typeof config> };
  expect(candidate.config.mqtt).toEqual({ enabled: true, endpoint: "mqtts://broker.example.test:8883", username: "publisher", source_interface: "lab0", password_ref: "a".repeat(32), interval_seconds: 30 });
  expect(JSON.stringify(candidate)).not.toContain("synthetic-mqtt-password");
  await navigate(page, "MQTT STREAMING");
  await expect(page.getByLabel("Broker URL", { exact: true })).toHaveValue("mqtts://broker.example.test:8883");
  await expect(page.getByLabel("Replacement password", { exact: true })).toHaveValue("");
  expect(errors).toEqual([]);
});

test("refresh discovery stays off the page and failures expand the connection circle", async ({ page }, testInfo) => {
  await page.clock.install();
  await mockBackend(page);
  let releaseRead!: () => void, failed = false;
  const initialRead = new Promise<void>(resolve => { releaseRead = resolve; });
  await page.route("**/proxy/state", async route => {
    await initialRead;
    if (failed) return route.fulfill({ status: 503, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: "Observation temporarily unavailable", transaction: null }) });
    return route.fallback();
  });
  await connect(page);
  const safety = page.getByRole("region", { name: "Global safety state", exact: true });
  const bubble = page.locator(".connection-bubble");
  await expect(safety).toHaveCount(0);
  await page.clock.fastForward(3100);
  await expect(safety).toHaveCount(0);
  await expect(bubble).toHaveAttribute("aria-label", "Connected");
  await expect(bubble).toHaveText("");
  await expect(bubble.locator(".v-icon")).toHaveCount(1);
  const healthy = (await bubble.boundingBox())!;
  expect(healthy.width).toBe(healthy.height); expect(healthy.width).toBeLessThanOrEqual(40);
  releaseRead();
  await expect(page.locator('[aria-label="Committed revision 0"]')).toBeVisible();
  failed = true;
  await page.clock.fastForward(6000);
  await expect(bubble).toHaveText("Read failed");
  await expect(bubble).toHaveClass(/connection-bubble--expanded/);
  const warning = (await bubble.boundingBox())!;
  expect(warning.width).toBeGreaterThan(warning.height);
  await expect(safety).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("connection-warning-bubble.png"), fullPage: true, animations: "disabled" });
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 200));
  await bubble.click();
  await page.clock.runFor(300);
  const menu = page.locator('.navigation-menu[aria-label="Registry session"]');
  await expect(menu).toContainText("Observation temporarily unavailable");
  failed = false;
  await menu.getByText("Retry", { exact: true }).click();
  await expect(bubble).toHaveAttribute("aria-label", "Connected");
  await expect(bubble).not.toHaveClass(/connection-bubble--expanded/);
  await expect(bubble).toHaveText("");
  await expect(safety).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
});

test("masquerading adds and edits inline without popups on desktop and mobile", async ({ page }, testInfo) => {
  const backend = await mockBackend(page);
  const dialogs: string[] = [];
  page.on("dialog", async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  await connect(page); await navigate(page, "NAT masquerading");
  await page.getByRole("button", { name: "Add rule", exact: true }).click();
  const editor = page.getByRole("row", { name: "Masquerade editor", exact: true });
  await expect(editor).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("Source network (blank = Any)", { exact: true }).fill("not-a-network");
  await page.getByLabel("Managed egress with family address", { exact: true }).press("Enter");
  await page.getByRole("option", { name: "lab0", exact: true }).click();
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(editor).toBeVisible();
  await page.getByLabel("Source network (blank = Any)", { exact: true }).fill("192.0.2.0/24");
  expect(await page.locator(".v-table__wrapper").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("masquerade-inline.png"), fullPage: true, animations: "disabled" });
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toHaveCount(0);
  const saved = page.getByRole("row").filter({ hasText: "192.0.2.0/24" });
  await saved.getByRole("button", { name: "Edit / stage", exact: true }).click();
  await expect(page.getByLabel("Source network (blank = Any)", { exact: true })).toHaveValue("192.0.2.0/24");
  await page.getByLabel("Source network (blank = Any)", { exact: true }).fill("198.51.100.0/24");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: "198.51.100.0/24" })).toBeVisible();
  await page.getByRole("button", { name: "Add rule", exact: true }).click();
  await page.getByLabel("Source network (blank = Any)", { exact: true }).fill("203.0.113.0/24");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(editor).toHaveCount(0);
  expect(dialogs).toEqual([]); expect(backend.writes).toHaveLength(0);
});

test("cosmetic device domain stages, commits and appears in the navbar without overflowing", async ({ page }, testInfo) => {
  const initial = config();
  initial.system = { hostname: "fw-1", domain: `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.example.test`, timezone: "UTC" };
  const backend = await mockBackend(page, { initialConfig: initial });
  await connect(page);
  const identity = page.getByRole("banner").getByLabel("Device name", { exact: true });
  await expect(identity).toHaveText(`fw-1.${initial.system.domain}`);
  await expect(identity).toHaveAttribute("title", `fw-1.${initial.system.domain}`);
  expect(await identity.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await navigate(page, "General");
  await expect(page.getByLabel("Domain name", { exact: true })).toHaveValue(initial.system.domain);
  await page.getByLabel("Domain name", { exact: true }).fill("Bad.Domain");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Domain name must be");
  await page.getByLabel("Host name", { exact: true }).fill("edge");
  await page.getByLabel("Domain name", { exact: true }).fill("home.example.test");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(identity).toHaveText(`fw-1.${initial.system.domain}`);
  expect(backend.writes).toEqual([]);
  await navigate(page, "SAVE");
  await page.getByRole("button", { name: "Commit & push", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("system.write");
  await page.getByRole("button", { name: "Push changes", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Confirm changes", exact: true })).toBeEnabled();
  expect(backend.writes[0]?.body).toMatchObject({ config: { system: { hostname: "edge", domain: "home.example.test", timezone: "UTC" } } });
  await page.getByRole("dialog").getByRole("button", { name: "Confirm changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(identity).toHaveText("edge.home.example.test");
  await page.reload();
  await expect(identity).toHaveText("edge.home.example.test");
  await navigate(page, "General");
  await expect(page.getByLabel("Domain name", { exact: true })).toHaveValue("home.example.test");
  await page.screenshot({ path: testInfo.outputPath("device-domain-general-settings.png"), fullPage: true, animations: "disabled" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("global IPv6 setting hides IPv6 UI and persists through commit", async ({ page }, testInfo) => {
  const initial = config(), original = initial.interfaces[0]!;
  initial.ipv6_enabled = true;
  initial.interfaces[0] = { ...original, kind: "ethernet", addresses: original.addresses.filter(address => !address.includes(":")) };
  const backend = await mockBackend(page, { initialConfig: initial, discoveredInterfaces: [
    { name: original.name, kind: "ethernet", index: 2, mac: null, mtu: original.mtu, up: true, ownership: "managed", addresses: ["192.0.2.10/24", "fe80::1/64"] },
    { name: "lo", kind: "loopback", index: 1, mac: null, mtu: 65536, up: true, ownership: "loopback", addresses: ["127.0.0.1/8", "::1/128"] },
  ] });
  await connect(page); await navigate(page, "General");
  const ipv6 = page.getByLabel("Enable IPv6", { exact: true });
  await expect(ipv6).toBeChecked();
  expect((await ipv6.boundingBox())!.y).toBeLessThan((await page.getByLabel("Allow all IPv4 ICMP", { exact: true }).boundingBox())!.y);
  await ipv6.uncheck(); await page.getByRole("button", { name: "Save", exact: true }).click();
  expect(backend.writes).toHaveLength(0);
  await navigate(page, "Physical interfaces");
  await expect(page.getByRole("columnheader", { name: "IPv6", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Edit / stage", exact: true }).click();
  await expect(page.getByLabel("IPv6 addresses / prefixes", { exact: true })).toHaveCount(0);
  await page.getByLabel("MTU", { exact: true }).fill("1450");
  expect(await page.locator(".v-table__wrapper").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("ipv4-only-interface.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await navigate(page, "Loopbacks");
  await expect(page.getByRole("main")).toContainText("127.0.0.1/8");
  await expect(page.getByRole("main")).not.toContainText("::1/128");
  await navigate(page, "NAT masquerading");
  await page.getByRole("button", { name: "Add rule", exact: true }).click();
  await page.getByLabel("Family", { exact: true }).press("Enter");
  await expect(page.getByRole("option", { name: "ipv4", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "ipv6", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await navigate(page, "Connections");
  await page.getByRole("button", { name: "More filters", exact: true }).click();
  await expect(page.getByLabel("Family", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("main")).not.toContainText("IPv6");
  await navigate(page, "SAVE");
  await expect(page.getByRole("main")).toContainText("Enable IPv6");
  await page.getByRole("button", { name: "Commit & push", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("kernel.namespace.write");
  await page.getByRole("button", { name: "Push changes", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Confirm changes", exact: true })).toBeEnabled();
  expect(backend.writes[0]?.body).toMatchObject({ config: { ipv6_enabled: false, interfaces: [{ name: original.name, mtu: 1450 }] } });
  await page.getByRole("dialog").getByRole("button", { name: "Confirm changes", exact: true }).click();
  await expect(page).toHaveURL(/\/config\/commits\/[^/]+$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload(); await navigate(page, "General");
  await expect(ipv6).not.toBeChecked();
  await ipv6.check(); await page.getByRole("button", { name: "Save", exact: true }).click();
  await navigate(page, "Physical interfaces");
  await expect(page.getByRole("columnheader", { name: "IPv6", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Edit / stage", exact: true }).click();
  await expect(page.getByLabel("IPv6 addresses / prefixes", { exact: true })).toBeVisible();
});

test("navbar tooltips appear once with readable contrast on hover and keyboard focus", async ({ page, isMobile }) => {
  test.skip(isMobile, "Hover tooltips require a mouse");
  await mockBackend(page);
  await connect(page);
  const status = page.getByRole("group", { name: "Firewall status" });
  const controls = [
    status.getByRole("link", { name: "Committed revision 0", exact: true }),
  ];
  const tooltip = page.getByRole("tooltip").filter({ has: page.locator(".v-overlay__content:visible") });
  for (const control of controls) {
    await control.hover();
    await expect(tooltip).toHaveCount(1);
    await expect(tooltip).toBeVisible();
    expect(await control.getAttribute("title")).toBeNull();
    const description = await control.getAttribute("aria-describedby");
    await expect(tooltip).toHaveAttribute("id", description!);
    const label = await control.getAttribute("aria-label");
    await expect(tooltip).toContainText(label!);
    const contrast = await tooltip.locator(".v-overlay__content").evaluate(element => {
      const style = getComputedStyle(element);
      const luminance = (color: string): number => {
        const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(channel => {
          const value = channel / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
      };
      const foreground = luminance(style.color), background = luminance(style.backgroundColor);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
    await page.getByRole("heading", { name: "Overview", exact: true }).hover();
    await expect(tooltip).toHaveCount(0);
  }
  await controls[0]!.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(controls[0]!).toBeFocused();
  await expect(tooltip).toHaveCount(1);
  await expect(tooltip).toHaveText("Committed revision 0");
});

test("top navigation opens routed sections in the black reference theme", async ({ page, isMobile }, testInfo) => {
  await mockBackend(page);
  await connect(page);
  await expect(page.locator(".v-navigation-drawer")).toHaveCount(0);
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  for (const section of navigationSections) {
    await openNavigation(page);
    await expect(navigation.getByRole("link").locator(".v-icon")).toHaveCount(6);
    if (section.name === "overview-section") {
      await expect(navigation.getByRole("link", { name: "Overview", exact: true })).toHaveCount(0);
      if (isMobile) await page.keyboard.press("Escape");
      await page.locator(".product-branding").click();
    } else if (section.name === "config-section") {
      await expect(navigation.getByRole("link", { name: "Config", exact: true })).toHaveCount(0);
      if (isMobile) await page.keyboard.press("Escape");
      await page.getByRole("group", { name: "Firewall status" }).getByRole("link", { name: /^Committed revision / }).click();
    } else await navigation.getByRole("link", { name: section.title, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${section.pages[0]!.path}$`));
    const pages = page.getByRole("navigation", { name: `${section.title} pages` });
    if (section.pages.length === 1 && section.name !== "settings-section") {
      await expect(pages).toHaveCount(0);
      const layout = await page.locator(".section-layout").boundingBox();
      const content = await page.locator(".section-content").boundingBox();
      expect(content!.width).toBe(layout!.width);
      expect(content!.x).toBe(layout!.x);
      await page.screenshot({ path: testInfo.outputPath(`${section.name}.png`), fullPage: true, animations: "disabled" });
      continue;
    }
    await expect(pages.getByRole("tab")).toHaveCount(section.pages.length);
    for (const entry of section.pages) {
      const expand = pages.getByRole("button", { name: /^Expand .* navigation$/ });
      if (await expand.isVisible()) await expand.click();
      await pages.getByRole("tab", { name: entry.title, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${entry.path}$`));
      if (entry.name === "connections" && !isMobile) await expect(pages.getByRole("tab")).toHaveCount(0);
      else await expect(pages.getByRole("tab", { name: entry.title, exact: true })).toHaveAttribute("aria-current", "page");
    }
  }
  await navigate(page, "Physical interfaces");
  await openNavigation(page);
  await expect(navigation.getByRole("link")).toHaveCount(6);
  for (const title of ["Interfaces", "Routing", "Firewall", "VPN", "Services", "Settings"]) {
    await expect(navigation.getByRole("link", { name: title, exact: true })).toBeVisible();
  }
  await expect(navigation.getByRole("link", { name: "Interfaces", exact: true })).toHaveAttribute("aria-current", "page");
  if (isMobile) await page.keyboard.press("Escape");
  expect(await page.locator(".app-header").evaluate(element => getComputedStyle(element).backgroundColor)).toBe("rgb(22, 27, 34)");
  expect(await page.locator(".product-name").evaluate(element => getComputedStyle(element).color)).toBe("rgb(83, 205, 186)");
  expect(await page.locator(".v-application").evaluate(element => getComputedStyle(element).backgroundColor)).toBe("rgb(10, 12, 16)");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const header = await page.locator(".app-header").boundingBox();
  const main = await page.getByRole("main").boundingBox();
  const content = await page.locator(".app-content").boundingBox();
  const contentPadding = await page.locator(".app-content").evaluate(element => parseFloat(getComputedStyle(element).paddingTop));
  expect(header).not.toBeNull();
  expect(main).not.toBeNull();
  expect(content).not.toBeNull();
  expect(main!.x).toBe(0);
  expect(content!.y + contentPadding).toBeGreaterThanOrEqual(header!.y + header!.height);
  const tabs = page.getByRole("navigation", { name: "Interfaces pages" }).getByRole("tablist");
  await expect(tabs).toHaveAttribute("aria-orientation", isMobile ? "horizontal" : "vertical");
  await expect(tabs.getByRole("tab").locator(".v-icon")).toHaveCount(0);
  const tabTypography = await tabs.getByRole("tab").first().evaluate(element => {
    const style = getComputedStyle(element);
    return { fontSize: style.fontSize, fontWeight: style.fontWeight, fontFamily: style.fontFamily };
  });
  expect(tabTypography).toEqual({
    fontSize: "14px", fontWeight: "500",
    fontFamily: await page.locator(".v-application").evaluate(element => getComputedStyle(element).fontFamily),
  });
  if (!isMobile) {
    const brand = await page.locator(".product-branding").boundingBox();
    const navbar = await navigation.boundingBox();
    const status = await page.getByRole("group", { name: "Firewall status" }).boundingBox();
    expect(brand!.x + brand!.width).toBeLessThanOrEqual(navbar!.x);
    expect(navbar!.x + navbar!.width).toBeLessThanOrEqual(status!.x);
    const rail = await page.locator(".section-navigation").boundingBox();
    const layout = await page.locator(".section-layout").boundingBox();
    expect(rail!.width / layout!.width).toBeCloseTo(0.25, 2);
  }
  await page.screenshot({ path: testInfo.outputPath("networking-section.png"), fullPage: true, animations: "disabled" });
  await page.locator(".product-branding").click();
  await expect(page).toHaveURL(/\/overview$/);
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Connected", exact: true }).click();
  await page.getByRole("list", { name: "Registry session" }).getByText("Disconnect", { exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Disconnect and clear local state?");
  await page.getByRole("button", { name: "Keep connected", exact: true }).click();
});

test("compact overview contains four live status widgets without diagnostic clutter", async ({ page, isMobile }, testInfo) => {
  const initial = config(), counters = statistics();
  initial.gateway_monitors = [monitor()];
  initial.dhcp_clients = { lab0: { client_id: "", hostname: "", route_metric: 0, use_mtu: false, use_domains: "no" } };
  initial.interfaces.push({
    name: "wg0", kind: "wireguard", role: "wan", mtu: 1420, up: true, addresses: ["10.0.0.1/24"], dhcp_relay: { enabled: false, servers: [] },
    wireguard: { key_ref: "wg-key", listen_port: 51820, peers: [] },
  });
  counters.sample.status = "available";
  counters.interfaces[0]!.status = "available"; counters.interfaces[0]!.oper_state = "UP";
  counters.interfaces.push({ name: "wg0", kind: "wireguard", ownership: "managed", mtu: 1420, admin_up: true, oper_state: "UP", status: "available", counters: { rx_packets: "1250000", tx_packets: "2450000", rx_bytes: "42100", tx_bytes: "84200", rx_errors: "0", tx_errors: "0" } });
  const backend = await mockBackend(page, { initialConfig: initial, statistics: counters, discoveredInterfaces: [
    { name: "lab0", kind: "dummy", index: 1, mac: null, mtu: 1500, up: true, ownership: "managed", addresses: ["192.0.2.99/24", "2001:db8:1234:5678:90ab:cdef:1234:5678/64"] },
    { name: "wg0", kind: "wireguard", index: 2, mac: null, mtu: 1420, up: true, ownership: "managed", addresses: ["10.0.0.1/24"] },
  ] });
  await connect(page);
  const dashboard = page.getByRole("region", { name: "Overview", exact: true });
  await expect(dashboard.getByRole("heading", { level: 2 })).toHaveText(["Interfaces", "Gateways", "WireGuard", "System stats", "Interface counters"]);
  await expect(dashboard.getByRole("region", { name: "Interfaces", exact: true }).getByRole("cell", { name: "Up", exact: true })).toHaveCount(2);
  const interfaceWidget = dashboard.getByRole("region", { name: "Interfaces", exact: true });
  await expect(interfaceWidget.getByRole("columnheader")).toHaveText(["Name", "Status", "Active IP", "Mode"]);
  await expect(interfaceWidget.locator(".v-chip.text-success")).toHaveCount(2);
  await expect(interfaceWidget).toContainText("192.0.2.99/24");
  await expect(interfaceWidget).toContainText("DHCP"); await expect(interfaceWidget).toContainText("Static");
  expect(await interfaceWidget.locator(".v-table__wrapper").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  const counterWidget = dashboard.getByRole("region", { name: "Interface counters", exact: true });
  await expect(counterWidget.getByRole("cell", { name: "18.45 EB", exact: true })).toBeVisible();
  await expect(counterWidget.getByRole("cell", { name: "18.45 EB", exact: true })).toHaveAttribute("title", "18446744073709551615");
  await expect(counterWidget).toContainText("1.25M"); await expect(counterWidget).toContainText("2.45M");
  await expect(counterWidget).toContainText("42.1 KB"); await expect(counterWidget).toContainText("84.2 KB");
  await expect(dashboard.getByRole("region", { name: "WireGuard", exact: true })).toContainText("51820");
  await expect(dashboard.getByRole("region", { name: "Gateways", exact: true })).toContainText("Simulated");
  await expect(dashboard).not.toContainText("Recent transactions");
  expect(backend.writes).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const interfaces = await dashboard.getByRole("region", { name: "Interfaces", exact: true }).boundingBox();
  const counts = await dashboard.getByRole("region", { name: "Interface counters", exact: true }).boundingBox();
  if (isMobile) expect(counts!.y).toBeGreaterThan(interfaces!.y);
  else expect(counts!.x).toBeGreaterThan(interfaces!.x);
  await page.screenshot({ path: testInfo.outputPath("compact-overview.png"), fullPage: true, animations: "disabled" });
});

test("connected bubble displays its icon inside the green circle", async ({ page }) => {
  await mockBackend(page);
  await connect(page);
  const bubble = page.getByRole("button", { name: "Connected", exact: true });
  await expect(bubble).toHaveClass(/bg-success/);
  await expect(bubble.locator(".v-icon.mdi-lan-connect")).toBeVisible();
  await expect(bubble).toHaveText("");
});

test("connection bubble stays bottom-right and settings uses the gear without a profile button", async ({ page, isMobile }, testInfo) => {
  await mockBackend(page);
  await page.goto("/connect");
  const tooltip = page.getByRole("tooltip").filter({ has: page.locator(".v-overlay__content:visible") });
  const offline = page.getByRole("button", { name: "Offline", exact: true });
  await expect(offline).toBeVisible(); await expect(offline).toHaveText("Offline");
  const offlineBounds = (await offline.boundingBox())!;
  expect(offlineBounds.width).toBeGreaterThan(offlineBounds.height);
  if (!isMobile) {
    await offline.hover();
    await expect(tooltip).toHaveText("Offline");
  }
  await signInToRegistry(page);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const bubble = page.getByRole("button", { name: "Connected", exact: true });
  await expect(bubble).toBeVisible();
  await expect(bubble).toHaveText("");
  if (!isMobile) {
    await bubble.hover();
    await expect(tooltip).toHaveText("Connected");
    await page.getByRole("banner").hover();
    await expect(tooltip).toHaveCount(0);
    await bubble.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(bubble).toBeFocused();
    await expect(tooltip).toHaveText("Connected");
    await bubble.blur();
  }
  await expect(page.getByRole("banner").getByRole("button", { name: "Connected", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Profile", exact: true })).toHaveCount(0);
  const bounds = await bubble.boundingBox(), viewport = page.viewportSize()!;
  expect(bounds!.width).toBe(40);
  expect(bounds!.height).toBe(40);
  expect(viewport.width - bounds!.x - bounds!.width).toBeCloseTo(20, 0);
  expect(viewport.height - bounds!.y - bounds!.height).toBeCloseTo(20, 0);
  await openNavigation(page);
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav.getByRole("link", { name: "Routing", exact: true }).locator(".mdi-transit-connection-variant")).toBeVisible();
  await expect(nav.getByRole("link", { name: "Firewall", exact: true }).locator(".mdi-wall")).toBeVisible();
  await expect(nav.getByRole("link", { name: "Settings", exact: true }).locator(".mdi-cog-outline")).toBeVisible();
  await nav.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "General settings", exact: true })).toBeVisible();
  const settingsPages = page.getByRole("navigation", { name: "Settings pages", exact: true });
  await expect(settingsPages.getByRole("tab", { name: "General", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(settingsPages.getByRole("tablist")).toHaveAttribute("aria-orientation", isMobile ? "horizontal" : "vertical");
  const settings = page.getByRole("region", { name: "General settings", exact: true });
  await expect(settings.locator(".v-card")).toHaveCount(0);
  await expect(settings.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  for (const name of ["Enable IPv6", "Allow all IPv4 ICMP"]) {
    const row = settings.locator(".setting-row").filter({ has: page.getByText(name, { exact: true }) });
    const label = (await row.locator(".setting-name").boundingBox())!;
    const control = (await row.locator(".setting-control").boundingBox())!;
    if (isMobile) {
      expect(control.y).toBeGreaterThanOrEqual(label.y + label.height);
      expect(control.x).toBeCloseTo(label.x, 0);
    } else {
      expect(control.x).toBeGreaterThanOrEqual(label.x + label.width + 24);
      expect(control.y).toBeCloseTo(label.y, 0);
    }
    await expect(settings.getByLabel(name, { exact: true })).toBeChecked();
  }
  if (!isMobile) {
    const rail = (await settingsPages.boundingBox())!, content = (await settings.boundingBox())!;
    expect(rail.x + rail.width).toBeLessThanOrEqual(content.x);
  }
  await page.screenshot({ path: testInfo.outputPath("general-settings.png"), fullPage: true, animations: "disabled" });
  await expect(page.getByLabel("Allow all IPv4 ICMP", { exact: true })).toBeChecked();
  await page.reload();
  await expect(page.getByRole("heading", { name: "General settings", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (!isMobile) {
    await page.setViewportSize({ width: 1280, height: 720 });
    const brand = await page.locator(".product-branding").boundingBox();
    const navigation = await nav.boundingBox();
    expect(brand!.x + brand!.width).toBeLessThanOrEqual(navigation!.x);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("section pages support direct detail links and browser history", async ({ page }) => {
  await mockBackend(page);
  await page.goto("/interfaces/lab0");
  await signInToRegistry(page);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("heading", { name: "lab0", exact: true })).toBeVisible();
  const pages = page.getByRole("navigation", { name: "Interfaces pages" });
  await expect(pages.getByRole("tab", { name: "Physical interfaces", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(pages.getByRole("tab", { name: "Static Routes", exact: true })).toHaveCount(0);
  await navigate(page, "Static Routes");
  await expect(page).toHaveURL(/\/routes$/);
  await expect(page.getByRole("navigation", { name: "Routing pages" }).getByRole("tab", { name: "Static Routes", exact: true })).toHaveAttribute("aria-current", "page");
  await page.goBack();
  await expect(page.getByRole("heading", { name: "lab0", exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("region", { name: "Static Routes", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("navigation", { name: "Routing pages" }).getByRole("tab", { name: "Static Routes", exact: true })).toHaveAttribute("aria-current", "page");
  await navigate(page, "NetFlow/IPFIX");
  await expect(page).toHaveURL(/\/services\/netflow$/);
  await expect(page.locator(".section-content tbody")).toContainText("capture");
  await expect(page.locator(".section-content").getByRole("link", { name: "capture", exact: true })).toHaveCount(0);
  await page.goto("/services/netflow/capture");
  await expect(page.getByRole("heading", { name: "capture", exact: true })).toBeVisible();
  await navigate(page, "PUSH REQUESTS");
  await page.locator(".section-content").getByRole("link", { name: "0", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Revision 0", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Config pages" }).getByRole("tab", { name: "PUSH REQUESTS", exact: true })).toHaveAttribute("aria-current", "page");
});

test("connection deletion requires distinct targeted and unfiltered namespace confirmations", async ({ page }, testInfo) => {
  const backend = await mockBackend(page), sample = connections(), row = sample.connections[0]!;
  await page.route("**/proxy/statistics/connections**", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...sample, connections: [row, { ...row, id: null, protocol: 253, protocol_name: "other" }] }) }));
  await connect(page); await navigate(page, "Connections");
  await expect(page.getByRole("button", { name: "Delete connection without identity", exact: true })).toBeDisabled();
  await page.getByLabel("IP address", { exact: true }).fill("198.51.100.20");
  await page.getByRole("button", { name: "Apply filters", exact: true }).click();
  await page.getByRole("button", { name: `Delete connection ${row.id}`, exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Management access and NAT sessions can be interrupted");
  expect(backend.writes).toHaveLength(0);
  await page.screenshot({ path: testInfo.outputPath("connection-delete-confirmation.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Delete state", exact: true }).click();
  await expect.poll(() => backend.writes.length).toBe(1);
  expect(backend.writes[0]).toEqual({ path: `/connections/${row.id}`, body: { family: row.family, protocol: row.protocol, zone: row.zone, original: row.original } });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Flush all connection states", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Current filters and pagination do not limit this flush");
  await expect(page.getByRole("dialog")).toContainText("All IPv4 and IPv6");
  await page.screenshot({ path: testInfo.outputPath("connection-flush-confirmation.png"), fullPage: true, animations: "disabled" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Flush ALL states", exact: true }).click();
  await expect.poll(() => backend.writes.length).toBe(2);
  expect(backend.writes[1]).toEqual({ path: "/connections", body: { confirm: true } });
});

test("signed self-upgrade confirms the canonical version and configured repository", async ({ page }, testInfo) => {
  await mockBackend(page);
  const writes: unknown[] = [];
  const job = { id: "upgrade-1", version: "1.2.3", status: "queued", created_at: "2026-10-24T00:00:00Z", updated_at: "2026-10-24T00:00:00Z", error: null, last_successful_version: null };
  await page.route("**/proxy/system/upgrade", route => {
    if (route.request().method() === "POST") {
      writes.push(route.request().postDataJSON());
      return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify(job) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: true, repository: "operator/appliance", job: writes.length ? job : null, last_successful_version: null }) });
  });
  await connect(page); await page.goto("/services/maintenance");
  await page.getByLabel("Version", { exact: true }).fill("v1.2.3");
  await expect(page.getByRole("button", { name: "Upgrade", exact: true })).toBeDisabled();
  const longestVersion = `1.2.3-${"a".repeat(74)}`;
  await page.getByLabel("Version", { exact: true }).fill(longestVersion);
  await page.getByRole("button", { name: "Upgrade", exact: true }).click();
  await expect(page.getByRole("dialog").getByText(`Upgrade to ${longestVersion}?`, { exact: true })).toBeVisible();
  expect(await page.getByRole("dialog").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("upgrade-long-version.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByLabel("Version", { exact: true }).fill("1.2.3");
  await page.getByRole("button", { name: "Upgrade", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("operator/appliance");
  await expect(page.getByRole("dialog")).toContainText("interrupt management connectivity");
  expect(writes).toHaveLength(0);
  await page.screenshot({ path: testInfo.outputPath("upgrade-confirmation.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Install upgrade", exact: true }).click();
  await expect.poll(() => writes.length).toBe(1); expect(writes[0]).toEqual({ version: "1.2.3" });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "System upgrade", exact: true })).toContainText("upgrade-1: queued");
  await expect(page.getByRole("button", { name: "Upgrade", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("upgrade-status.png"), fullPage: true, animations: "disabled" });
});

test("connections viewer filters and pages read-only snapshots with exact counters", async ({ page, isMobile }, testInfo) => {
  const backend = await mockBackend(page), reads: URL[] = [];
  const sample = connections(), first = sample.connections[0]!;
  const rows: typeof sample.connections = [first, {
    ...first, id: "43", protocol: 17, protocol_name: "udp", tcp_state: null, state: "UNREPLIED", seen_reply: false, assured: false, source_nat: false, status: 0, timeout_seconds: 28,
    original: { ...first.original, source: "192.0.2.11", destination: "224.0.0.251", source_port: 5353, destination_port: 5353 },
    reply: { ...first.reply, source: "224.0.0.251", destination: "192.0.2.11", source_port: 5353, destination_port: 5353 },
    original_counters: { packets: "3", bytes: "1500" }, reply_counters: { packets: "7", bytes: "2500" },
  }, {
    ...first, id: "44", family: "ipv6", protocol: 58, protocol_name: "icmpv6", tcp_state: null, state: "UNREPLIED", seen_reply: false, assured: false, source_nat: false, status: 0, timeout_seconds: 30,
    original: { ...first.original, source: "2001:db8:abcd:1234:5678:90ab:cdef:1234", destination: "2001:db8:ffff:9876:5432:10fe:dcba:9876", source_port: null, destination_port: null, icmp_id: 10, icmp_type: 128, icmp_code: 0 },
    reply: { ...first.reply, source: "2001:db8:ffff:9876:5432:10fe:dcba:9876", destination: "2001:db8:abcd:1234:5678:90ab:cdef:1234", source_port: null, destination_port: null, icmp_id: 10, icmp_type: 129, icmp_code: 0 },
    original_counters: null,
  }, {
    ...first, id: "45", state: "TIME_WAIT", tcp_state: 6, source_nat: false, timeout_seconds: 55,
    original: { ...first.original, source: "10.0.0.24", destination: "198.51.100.55", source_port: 54132 },
    reply: { ...first.reply, source: "198.51.100.55", destination: "10.0.0.24", destination_port: 54132 },
    original_counters: { packets: "217", bytes: "16384" },
  }, {
    ...first, id: "46", protocol: 253, protocol_name: "other", tcp_state: null, state: "TRACKED", source_nat: false, timeout_seconds: null,
    original: { ...first.original, source_port: null, destination_port: null }, reply: { ...first.reply, source_port: null, destination_port: null },
    original_counters: { packets: "0", bytes: "0" }, reply_counters: { packets: "0", bytes: "0" },
  }];
  await page.route("**/proxy/statistics/connections**", async route => {
    expect(route.request().method()).toBe("GET");
    const url = new URL(route.request().url()); reads.push(url);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const filtered = url.searchParams.has("address") ? [first] : rows;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...sample, connections: filtered, summary: { total: rows.length, matched: filtered.length, returned: filtered.length, accounting_unavailable: filtered.filter(row => !row.original_counters || !row.reply_counters).length }, offset, next_offset: offset === 0 ? 100 : null }) });
  });
  await connect(page); await navigate(page, "Connections");
  const view = page.getByRole("region", { name: "Connections", exact: true });
  if (!isMobile) {
    await expect(view.getByRole("columnheader", { name: "Source", exact: true })).toBeVisible();
    await expect(view.getByRole("columnheader", { name: "Destination", exact: true })).toBeVisible();
  }
  await expect(view.getByRole("columnheader", { name: "Reply", exact: true })).toHaveCount(0);
  await expect(view.locator(".connection-bytes").first()).toHaveAttribute("title", "18446744073709551615 bytes");
  await expect(view.locator(".connection-bytes").first()).toHaveText("18.4 EB");
  await expect(view.locator('[data-label="Received packets"]').first()).toHaveText("Unavailable");
  await expect(view.locator('[data-label="Received bytes"]').first()).toHaveText("Unavailable");
  for (const label of ["Sent packets", "Received packets", "Sent bytes", "Received bytes", "Delete"]) {
    await expect(view.getByRole("columnheader", { name: label, exact: true })).toHaveCount(1);
  }
  await expect(view.locator(".connection-row > .connection-actions button")).toHaveCount(5);
  await expect(view.locator(".connection-state button")).toHaveCount(0);
  await expect(view).toContainText("UDP"); await expect(view).toContainText("ICMPV6"); await expect(view).toContainText("IP 253");
  await expect(view).toContainText("Unavailable"); await expect(view).toContainText("SNAT");
  expect(await view.locator(".connection-state").first().evaluate(element => getComputedStyle(element).whiteSpace)).toBe("nowrap");
  if (!isMobile) {
    await expect(page.locator(".section-layout")).toHaveClass(/section-layout--collapsed/);
    const sidebar = page.getByRole("navigation", { name: "Firewall pages", exact: true });
    expect((await sidebar.boundingBox())!.width).toBeLessThanOrEqual(60);
    await expect(sidebar.getByRole("tab")).toHaveCount(0);
    await expect(sidebar.locator(".v-icon")).toHaveCount(1);
    await page.getByRole("button", { name: "Expand Firewall navigation", exact: true }).click();
    await expect(page.locator(".section-layout")).not.toHaveClass(/section-layout--collapsed/);
    await expect(sidebar.getByRole("tab")).toHaveCount(4);
    await expect(sidebar.getByRole("tab").locator(".v-icon")).toHaveCount(0);
    await page.getByRole("button", { name: "Collapse Firewall navigation", exact: true }).click();
    await expect(sidebar.getByRole("tab")).toHaveCount(0);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  {
    const firstRow = view.locator(".connection-row").first();
    const tableBounds = (await view.locator(".connections-table").boundingBox())!;
    for (const cell of await firstRow.locator("td").all()) {
        const bounds = (await cell.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(tableBounds.x); expect(bounds.x + bounds.width).toBeLessThanOrEqual(Math.min(page.viewportSize()!.width, tableBounds.x + tableBounds.width));
    }
  }
  await view.locator(".connection-state-filter .v-field").click();
  await page.getByRole("option", { name: "UNREPLIED", exact: true }).click();
  await expect(view.locator(".connection-row")).toHaveCount(2);
  await expect(view.locator(".connection-state")).toHaveText(["UNREPLIED", "UNREPLIED"]);
  await expect(view.locator(".connection-footer")).toContainText("2 shown");
  expect(reads.at(-1)!.searchParams.has("state")).toBe(false);
  await view.locator(".connection-state-filter .v-field").click();
  await page.getByRole("option", { name: "All states", exact: true }).click();
  await expect(view.locator(".connection-row")).toHaveCount(5);
  for (const [label, ascending, descending] of [["Received packets", "0", "7"], ["Received bytes", "0 B", "2.5 KB"]]) {
    const header = view.getByRole("columnheader", { name: label, exact: true });
    await header.getByRole("button").click();
    await expect(header).toHaveAttribute("aria-sort", "ascending");
    await expect(view.locator(`[data-label="${label}"]`).first()).toHaveText(ascending!);
    await header.getByRole("button").click();
    await expect(header).toHaveAttribute("aria-sort", "descending");
    await expect(view.locator(`[data-label="${label}"]`).first()).toHaveText(descending!);
    await expect(view.locator(`[data-label="${label}"]`).last()).toHaveText("Unavailable");
  }
  const packetsHeader = view.getByRole("columnheader", { name: "Sent packets", exact: true });
  await packetsHeader.getByRole("button").click();
  await expect(packetsHeader).toHaveAttribute("aria-sort", "ascending");
  await expect(view.locator('.connection-row [data-label="Sent packets"]').first()).toHaveText("0");
  await packetsHeader.getByRole("button").press("Enter");
  await expect(packetsHeader).toHaveAttribute("aria-sort", "descending");
  await expect(view.locator('.connection-row [data-label="Sent packets"]').first()).toHaveText("9007199254740993");
  await expect(view.locator('.connection-row [data-label="Sent packets"]').last()).toHaveText("Unavailable");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("connections.png"), fullPage: true, animations: "disabled" });
  await expect(view.getByRole("button", { name: /^Connection details/ })).toHaveCount(0);
  await expect(view.locator(".connection-details")).toHaveCount(0);
  await expect(view.locator(".connection-number").first()).toHaveText("9007199254740993");
  await view.getByRole("button", { name: "Next connections page", exact: true }).click();
  await expect(view).toContainText("Offset 100"); expect(reads.at(-1)!.searchParams.get("offset")).toBe("100");
  await view.getByLabel("IP address", { exact: true }).fill("198.51.100.20");
  await view.getByRole("button", { name: "More filters", exact: true }).click();
  await view.getByLabel("Port", { exact: true }).fill("443");
  await view.getByRole("button", { name: "Apply filters", exact: true }).click();
  await expect.poll(() => reads.at(-1)!.searchParams.get("port")).toBe("443");
  expect(reads.at(-1)!.searchParams.get("address")).toBe("198.51.100.20"); expect(reads.at(-1)!.searchParams.get("offset")).toBe("0");
  await expect(view).toContainText("Offset 0");
  await view.getByRole("checkbox", { name: "Live", exact: true }).uncheck();
  await expect(view.getByRole("status")).toContainText("Paused");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(backend.writes).toHaveLength(0);
  await navigate(page, "Static Routes");
  await expect(page.locator(".section-layout")).not.toHaveClass(/section-layout--collapsed/);
});

test("loopbacks edits dummy interfaces and keeps lo read-only outside Physical interfaces", async ({ page }, testInfo) => {
  const initial = config(), original = initial.interfaces[0]!;
  const backend = await mockBackend(page, { initialConfig: initial, discoveredInterfaces: [
    { name: original.name, kind: "dummy", index: 2, mac: null, mtu: original.mtu, up: true, ownership: "managed", addresses: ["192.0.2.99/24"] },
    { name: "lo", kind: "loopback", index: 1, mac: null, mtu: 65536, up: true, ownership: "loopback", addresses: ["127.0.0.1/8", "::1/128"] },
  ] });
  await connect(page); await navigate(page, "Physical interfaces");
  const physical = page.getByRole("region", { name: "Physical interfaces", exact: true });
  await expect(physical.getByRole("cell", { name: "lo", exact: true })).toHaveCount(0);
  await expect(physical.getByRole("cell", { name: original.name, exact: true })).toHaveCount(0);
  await navigate(page, "Loopbacks");
  const view = page.getByRole("region", { name: "Loopbacks", exact: true });
  const loopback = view.getByRole("row").filter({ has: page.getByRole("cell", { name: "lo", exact: true }) });
  await expect(loopback).toContainText("127.0.0.1/8, ::1/128");
  await expect(loopback).toContainText("Read-only"); await expect(loopback.getByRole("button")).toHaveCount(0);
  await expect(view.getByRole("columnheader", { name: "Reload DHCP", exact: true })).toHaveCount(0);
  const dummy = view.getByRole("row").filter({ has: page.getByRole("cell", { name: original.name, exact: true }) });
  await expect(dummy).toContainText("192.0.2.99/24");
  await dummy.getByRole("button", { name: "Edit / stage", exact: true }).click();
  const editor = view.getByRole("row", { name: "Loopback editor", exact: true });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(editor.getByRole("combobox", { name: "Kind", exact: true })).toHaveCount(0);
  await expect(editor.getByLabel("MTU", { exact: true })).toHaveCount(0);
  await expect(editor.getByRole("cell", { name: String(original.mtu), exact: true })).toBeVisible();
  await expect(editor.getByRole("checkbox", { name: "Admin state", exact: true })).toBeChecked();
  await expect(editor.getByRole("combobox", { name: "Role", exact: true })).toHaveCount(1);
  await editor.locator(".role-cell .v-field").click();
  await page.getByRole("option", { name: "Unassigned", exact: true }).click();
  const roleSelection = editor.locator(".role-cell .v-select__selection-text");
  await expect(roleSelection).toHaveText("Unassigned");
  expect(await roleSelection.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("loopback-editor.png"), fullPage: true, animations: "disabled" });
  await expect(editor.getByLabel("IPv4 addresses / prefixes", { exact: true })).toHaveValue(original.addresses.filter(address => !address.includes(":")).join(", "));
  await editor.getByLabel("IPv4 addresses / prefixes", { exact: true }).fill("10.10.0.1/32");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expect(dummy).toContainText(String(original.mtu)); await expect(dummy).not.toContainText("Unsaved");
  await expect(view.getByRole("columnheader", { name: "Changes", exact: true })).toHaveCount(0);
  await expect(loopback).toContainText("Read-only"); await expect(loopback.getByRole("button")).toHaveCount(0);
  await navigate(page, "Physical interfaces"); await navigate(page, "Loopbacks");
  await expect(dummy).toContainText(String(original.mtu));
  expect(backend.writes).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("loopbacks.png"), fullPage: true, animations: "disabled" });
  expect(await view.locator(".v-table__wrapper").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("tables use compact spacing across resource, overview, and connection pages", async ({ page, isMobile }, testInfo) => {
  const initial = config(), original = initial.interfaces[0]!;
  initial.ipv6_enabled = false;
  initial.interfaces = [
    { ...original, name: "eth0", kind: "ethernet", addresses: ["192.0.2.10/24"] },
    { ...original, addresses: ["10.0.0.1/32"] },
    { ...original, name: "vlan10", kind: "vlan", addresses: ["10.10.0.1/24"], vlan: { parent: "eth0", id: 10 } },
  ];
  await mockBackend(page, { initialConfig: initial, discoveredInterfaces: initial.interfaces.map((link, index) => ({
    name: link.name, kind: link.kind, index: index + 2, mac: null, mtu: link.mtu, up: link.up,
    addresses: link.addresses, ownership: "managed",
  })) });
  await connect(page);
  await expect(page.locator(".v-table").first()).toBeVisible();
  for (const table of await page.locator(".v-table").all()) {
    await expect(table).toHaveClass(/v-table--density-compact/);
  }
  for (const label of ["Physical interfaces", "VLANs", "Loopbacks", "Static Routes", "DHCPv4 relay", "Connections"]) {
    await navigate(page, label);
    const table = page.getByRole("main").locator(".v-table").first();
    await expect(table).toHaveClass(/v-table--density-compact/);
    const row = table.locator("tbody > tr").first();
    await expect(row).toBeVisible();
    if (!isMobile) {
      expect((await row.boundingBox())!.height, `${label} row height`).toBeLessThanOrEqual(44);
    }
    if (label !== "DHCPv4 relay") {
      expect(await table.locator(".v-table__wrapper").evaluate(element => element.scrollWidth <= element.clientWidth), `${label} table overflow`).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label} page overflow`).toBe(true);
    if (label === "Physical interfaces" || label === "VLANs" || label === "Loopbacks") {
      const button = row.getByRole("button", { name: "Edit / stage", exact: true });
      await expect(button).toBeVisible();
      await button.click();
      await expect(table.getByRole("button", { name: "Save", exact: true })).toBeVisible();
      await table.getByRole("button", { name: "Cancel", exact: true }).click();
    }
  }
  await page.screenshot({ path: testInfo.outputPath("compact-connections.png"), fullPage: true, animations: "disabled" });
});

test("physical interfaces stay compact and show DHCP IPv4 read-only", async ({ page, isMobile }, testInfo) => {
  const initial = config(), original = initial.interfaces[0]!;
  initial.interfaces = ["eno1", "enp3s0", "wlp1s0"].map((name, index) => ({ ...original, name, kind: "ethernet", role: "unassigned", addresses: index === 0 ? ["172.16.10.2/24"] : [] }));
  initial.dhcp_clients = { enp3s0: { client_id: "", hostname: "", route_metric: 0, use_mtu: false, use_domains: "no" } };
  initial.routes = []; initial.softflowd = []; initial.firewall.nat.masquerade = [];
  const discovered = initial.interfaces.map((link, index) => ({ name: link.name, kind: link.kind, index: index + 2, mac: "02:00:00:00:00:01", mtu: link.mtu, up: link.up, addresses: link.addresses, ownership: "managed" as const }));
  const inventory = [
    ...discovered.map(link => link.name === "eno1" ? { ...link, addresses: ["172.16.10.99/24", "fe80::2/64"] } : link.name === "enp3s0" ? { ...link, addresses: ["192.0.2.123/24", "2001:db8::123/64"] } : link),
    { ...discovered[0]!, name: "lo", kind: "loopback", ownership: "loopback" as const, addresses: ["127.0.0.1/8", "::1/128"] },
    { ...discovered[0]!, name: "br0", kind: "bridge", ownership: "unmanaged" as const, up: false, addresses: ["198.51.100.1/24"] },
    { ...discovered[0]!, name: "spare0", ownership: "unmanaged" as const, up: false, addresses: [] },
  ];
  const backend = await mockBackend(page, { initialConfig: initial, discoveredInterfaces: inventory });
  await connect(page); await navigate(page, "Physical interfaces");
  const view = page.getByRole("region", { name: "Physical interfaces", exact: true });
  await expect(view.getByRole("button", { name: "Add interface", exact: true })).toHaveCount(0);
  await expect(view.getByRole("heading")).toHaveCount(0);
  await expect(view.getByRole("table")).toHaveCount(1);
  await expect(view.getByRole("row")).toHaveCount(6);
  await expect(view.getByRole("columnheader", { name: "Active Addresses", exact: true })).toHaveCount(0);
  await expect(view.getByRole("columnheader")).toHaveCount(8);
  await expect(view.getByRole("columnheader", { name: "Mode", exact: true })).toHaveCount(1);
  await expect(view.getByRole("row").filter({ hasText: "eno1" })).toContainText("Static");
  await expect(view.getByRole("button", { name: /Reload DHCP/ })).toHaveCount(0);
  await expect(view.getByRole("columnheader", { name: "Configured Static Addresses", exact: true })).toHaveCount(0);
  const dhcp = view.getByRole("row").filter({ has: page.getByRole("cell", { name: "enp3s0", exact: true }) });
  await expect(dhcp).toContainText("192.0.2.123/24");
  await expect(dhcp).toContainText("DHCP");
  await dhcp.getByRole("cell", { name: "enp3s0", exact: true }).click();
  const dhcpEditor = page.getByRole("row", { name: "Configure enp3s0", exact: true });
  await expect(dhcpEditor.getByRole("button", { name: /Reload DHCP/ })).toHaveCount(0);
  await expect(dhcpEditor.getByLabel("IPv4 addresses / prefixes", { exact: true })).toHaveValue("192.0.2.123/24");
  await expect(dhcpEditor.getByLabel("IPv4 addresses / prefixes", { exact: true })).toBeDisabled();
  await dhcpEditor.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(view.getByRole("cell", { name: "lo", exact: true })).toHaveCount(0);
  await expect(view.getByRole("row").filter({ hasText: "spare0" })).toContainText("Down");
  await expect(view.getByRole("row").filter({ hasText: "br0" })).toContainText("Read-only");
  await expect(view.getByRole("cell", { name: "172.16.10.2/24", exact: true })).toBeVisible();
  await expect(view.getByRole("textbox")).toHaveCount(0);
  await expect(view.getByRole("combobox")).toHaveCount(0);
  await expect(view).not.toContainText("Show staged draft");
  await expect(view).not.toContainText("Discovered interfaces");
  await expect(view).not.toContainText("DHCPv4 leases");
  await expect(view).not.toContainText("Full configured");
  await expect(view.getByRole("table")).not.toContainText("[");
  await expect(view.getByRole("table")).not.toContainText("{");
  if (!isMobile) expect((await view.getByRole("row").filter({ hasText: "eno1" }).boundingBox())!.height).toBeLessThanOrEqual(80);
  const layout = await view.locator(".v-table__wrapper").evaluate(element => ({
    width: element.clientWidth, content: element.scrollWidth,
    columns: [...element.querySelectorAll("thead th")].map(cell => ({ name: cell.textContent?.trim(), width: cell.getBoundingClientRect().width })),
  }));
  expect(layout.content, JSON.stringify(layout)).toBeLessThanOrEqual(layout.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("interfaces-clean.png"), fullPage: true, animations: "disabled" });
  const row = view.getByRole("row").filter({ hasText: "eno1" });
  await row.getByRole("cell", { name: "eno1", exact: true }).click();
  await expect(view.getByRole("link", { name: "eno1", exact: true })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const settings = page.getByRole("row", { name: "Configure eno1", exact: true });
  await expect(view.getByRole("row")).toHaveCount(6);
  await expect(settings.getByRole("combobox")).toHaveCount(3);
  await expect(settings.locator("td[colspan]")).toHaveCount(0);
  await expect(settings).not.toContainText("Changing a management NIC");
  await settings.getByLabel("MTU", { exact: true }).fill("1450");
  await settings.getByLabel("Display name", { exact: true }).fill("Primary uplink");
  await settings.getByLabel("IPv4 addresses / prefixes", { exact: true }).fill("172.16.10.3/24");
  await settings.getByLabel("IPv6 addresses / prefixes", { exact: true }).fill("2001:db8::2/64");
  await settings.getByRole("combobox", { name: "Role", exact: true }).selectOption("wan");
  for (const [label, minimum] of [["MTU", 60], ["Display name", 96], ["IPv4 addresses / prefixes", 120], ["IPv6 addresses / prefixes", 100]] as const) {
    expect((await settings.getByLabel(label, { exact: true }).boundingBox())!.width, `${label} remains usable`).toBeGreaterThanOrEqual(minimum);
  }
  const modeBounds = (await settings.getByRole("combobox", { name: "IPv4 configuration", exact: true }).boundingBox())!;
  const addressBounds = (await settings.getByLabel("IPv4 addresses / prefixes", { exact: true }).boundingBox())!;
  if (!isMobile) {
    expect(Math.abs(modeBounds.y - addressBounds.y), "Mode and IPv4 address align in one row").toBeLessThanOrEqual(1);
    expect(addressBounds.x).toBeGreaterThanOrEqual(modeBounds.x + modeBounds.width);
    expect((await view.getByRole("columnheader", { name: "Name", exact: true }).boundingBox())!.width).toBeGreaterThanOrEqual(140);
    expect((await view.getByRole("columnheader", { name: "IPv6", exact: true }).boundingBox())!.width).toBeLessThanOrEqual(200);
  }
  for (const cell of await settings.locator("td").all()) {
    expect(await cell.evaluate(element => element.scrollWidth <= element.clientWidth + 1), "Editor cell content fits").toBe(true);
  }
  expect(await view.locator(".v-table__wrapper").evaluate(element => element.scrollWidth <= element.clientWidth), "Editor fits without horizontal scrolling").toBe(true);
  const tableBounds = (await view.locator(".v-table__wrapper").boundingBox())!;
  const stageBounds = (await settings.getByRole("button", { name: "Save", exact: true }).boundingBox())!;
  expect(stageBounds.x + stageBounds.width, "Stage fits inside the table").toBeLessThanOrEqual(tableBounds.x + tableBounds.width);
  for (const button of await view.locator("td:last-child .v-btn").all()) {
    expect(await button.evaluate(element => element.scrollHeight <= element.clientHeight && element.scrollWidth <= element.clientWidth), "Row action label fits its button").toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath("interface-inline.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(settings).toHaveCount(0);
  await expect(row).toContainText("Primary uplink"); await expect(row).toContainText("eno1");
  await expect(row).toContainText("172.16.10.3/24"); await expect(row).toContainText("2001:db8::2/64");
  await expect(row).not.toContainText("172.16.10.99/24");
  await expect(row).toContainText("WAN");
  await expect(row.getByRole("cell", { name: "1450", exact: true })).toBeVisible();
  await expect(view.getByRole("columnheader", { name: "Changes", exact: true })).toHaveCount(0);
  await expect(row).not.toContainText("Unsaved");
  expect(await view.locator(".v-table__wrapper").evaluate(element => element.scrollWidth <= element.clientWidth), "Staging does not add overflow").toBe(true);
  if (!isMobile) {
    for (const width of [1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Scrolling stays inside the table at ${width}px`).toBe(true);
      expect(await view.locator(".v-table__wrapper").evaluate(element => element.scrollWidth <= element.clientWidth), `Table fits at ${width}px`).toBe(true);
    }
    await row.getByRole("button", { name: "Edit / stage", exact: true }).click();
    await page.setViewportSize({ width: 1024, height: 900 });
    expect((await settings.getByLabel("MTU", { exact: true }).boundingBox())!.width).toBeGreaterThanOrEqual(60);
    expect(await view.locator(".v-table__wrapper").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await settings.getByRole("button", { name: "Cancel", exact: true }).click();
  }
  await expect(row.getByRole("cell", { name: "1450", exact: true })).toBeVisible();
  await navigate(page, "Static Routes"); await navigate(page, "Physical interfaces");
  await expect(row.getByRole("cell", { name: "1450", exact: true })).toBeVisible();
  expect(backend.writes).toHaveLength(0);
});

test("staged changes shows an expanded unified diff without JSON panels", async ({ page }, testInfo) => {
  const initial = config(); initial.interfaces[0]!.kind = "ethernet";
  const backend = await mockBackend(page, { initialConfig: initial, discoveredInterfaces: [{
    name: "lab0", kind: "ethernet", index: 2, mac: "02:00:00:00:00:02", mtu: 1500,
    up: true, addresses: initial.interfaces[0]!.addresses, ownership: "managed",
  }] });
  await connect(page); await navigate(page, "Physical interfaces");
  await page.getByRole("region", { name: "Physical interfaces", exact: true }).getByRole("cell", { name: "lab0", exact: true }).click();
  const editor = page.getByRole("row", { name: "Configure lab0", exact: true });
  await editor.getByLabel("MTU", { exact: true }).fill("1400");
  await editor.getByLabel("Display name", { exact: true }).fill("Office uplink with a long descriptive name to verify horizontal scrolling stays inside the diff");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await navigate(page, "SAVE");
  const view = page.getByRole("region", { name: "SAVE", exact: true });
  await expect(view.getByRole("heading", { name: "interfaces / lab0", exact: true })).toBeVisible();
  await expect(view.locator(".deletion .line-code").filter({ hasText: '"mtu": 1500' })).toBeVisible();
  await expect(view.locator(".addition .line-code").filter({ hasText: '"mtu": 1400' })).toBeVisible();
  await expect(view.locator(".context").first()).toBeVisible();
  await expect(view.locator(".v-expansion-panel")).toHaveCount(0);
  await expect(view.getByRole("button", { name: "Commit & push", exact: true })).toBeEnabled();
  await expect(view.locator('input[type="file"]')).toHaveCount(0);
  await expect(view.getByRole("button", { name: "Export draft config", exact: true })).toHaveCount(0);
  await expect(view.getByRole("button", { name: "Refresh state", exact: true })).toHaveCount(0);
  await expect(view.getByText("Import configuration", { exact: true })).toHaveCount(0);
  expect(await view.locator(".addition .line-code").first().evaluate(element => getComputedStyle(element).whiteSpace)).toBe("pre");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(backend.writes).toHaveLength(0);
  await page.screenshot({ path: testInfo.outputPath("staged-diff.png"), fullPage: true, animations: "disabled" });
});

test("host NIC discovery stages simple inline DHCP without live writes", async ({ page }, testInfo) => {
  const initial = config();
  initial.interfaces[0] = { ...initial.interfaces[0]!, kind: "ethernet", role: "unassigned" };
  const backend = await mockBackend(page, { initialConfig: initial, discoveredInterfaces: [{
    name: "eth1", kind: "ethernet", index: 3, mac: "02:00:00:00:00:03", mtu: 1500,
    up: true, addresses: ["192.0.2.99/24"], ownership: "unmanaged",
  }] });
  await connect(page);
  await navigate(page, "Physical interfaces");
  await page.getByRole("button", { name: "Manage this interface", exact: true }).click();
  await expect(page.getByLabel("IPv4 addresses / prefixes", { exact: true })).toHaveValue("");
  await page.getByRole("row", { name: "Configure eth1", exact: true }).getByRole("combobox", { name: "IPv4 configuration", exact: true }).selectOption("dhcp");
  await page.getByLabel("Display name", { exact: true }).fill("New uplink");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(backend.writes).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo(0, 0); });
  await page.screenshot({ path: testInfo.outputPath("host-interfaces.png"), fullPage: true });
  await navigate(page, "SAVE");
  await expect(page.getByRole("main")).toContainText("dhcp_clients");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("invalid stored firewall keys are proxied once and never sent to the browser", async ({ page }) => {
  await mockBackend(page, { invalidCredential: true });
  const proxyRequests: string[] = [], directRequests: string[] = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.port === "3031" && url.pathname.includes("/proxy/transactions")) proxyRequests.push(url.href);
    if (url.port === "8080") directRequests.push(url.href);
  });
  await page.goto("/connect");
  await signInToRegistry(page);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "401" }).first()).toBeVisible();
  await page.waitForTimeout(1500);
  expect(proxyRequests).toHaveLength(1);
  expect(directRequests).toHaveLength(0);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

test("recovery remains accessible when state observation is unavailable", async ({ page }) => {
  await mockBackend(page, { observationFailed: true, initialStatus: "recovery_failed" });
  await connect(page);
  await expect(page.getByText("Critical: recovery failed", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry rollback", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("static route Status stages only enabled and preserves the path through confirmed push", async ({ page }, testInfo) => {
  const initial = config();
  initial.routes[0]!.gateway = "192.0.2.1";
  initial.routes[0]!.metadata = { display_name: "Management path", description: "Retained while disabled" };
  const backend = await mockBackend(page, { initialConfig: initial });
  await connect(page); await navigate(page, "Static Routes");
  const routes = page.getByRole("region", { name: "Static Routes", exact: true });
  await expect(routes.getByRole("columnheader")).toHaveText(["Destination", "Interface", "Metric", "Status", "Actions"]);
  const enabled = routes.getByRole("checkbox", { name: "Route enabled for 198.51.100.0/24", exact: true });
  await expect(enabled).toBeChecked();
  const popupMessages: string[] = [];
  page.on("dialog", async dialog => { popupMessages.push(dialog.message()); await dialog.dismiss(); });
  await enabled.uncheck(); await expect(enabled).not.toBeChecked();
  expect(popupMessages).toEqual([]);
  await expect(routes).toContainText("Management path");
  expect(backend.writes).toHaveLength(0);
  expect(await routes.locator(".v-table__wrapper").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("route-status.png"), fullPage: true, animations: "disabled" });
  await navigate(page, "SAVE");
  await page.getByRole("button", { name: "Commit & push", exact: true }).click();
  await page.getByLabel("Commit message", { exact: true }).fill("Disable the retained management route");
  await expect(page.getByRole("dialog")).toContainText("routes.write");
  await page.getByRole("button", { name: "Push changes", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Confirm changes", exact: true })).toBeEnabled();
  const expected = structuredClone(initial); expected.routes[0]!.enabled = false;
  expect(backend.writes).toHaveLength(1);
  expect(backend.writes[0]?.body).toMatchObject({ config: expected });
  await page.getByRole("dialog").getByRole("button", { name: "Confirm changes", exact: true }).click();
  await expect(page).toHaveURL(/\/config\/commits\/[^/]+$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const results = page.getByRole("region", { name: "Commit detail", exact: true });
  await expect(results).toContainText("committed");
  const metadata = results.locator(".record-metadata");
  await expect(metadata.locator("dt")).toHaveText(["Status", "Base revision", "Result revision", "Actor", "Submitted (UTC)", "Committed (UTC)", "Comment"]);
  await expect(metadata).toContainText("Disable the retained management route");
  await expect(metadata.locator("dd").filter({ hasText: "operator" })).toHaveCount(1);
  await expect(results.getByText(/^(Commit details|All commits)$/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Done", exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("commit-results.png"), fullPage: true, animations: "disabled" });
  await navigate(page, "Static Routes"); await expect(enabled).not.toBeChecked();
});

test("routing pages add and edit inline without overflow", async ({ page }, testInfo) => {
  const initial = config(); initial.gateway_monitors = [monitor()];
  initial.routes.push({ ...initial.routes[0]!, table: 254 });
  const backend = await mockBackend(page, { initialConfig: initial });
  await connect(page); await navigate(page, "Static Routes");
  await page.getByRole("button", { name: "Add Static Route", exact: true }).click();
  const route = page.getByRole("row", { name: "Route editor", exact: true });
  await expect(route).toBeVisible(); await expect(page.getByRole("dialog")).toHaveCount(0);
  await route.getByLabel("Destination network", { exact: true }).fill("203.0.113.0/24");
  await route.getByLabel("Gateway interface", { exact: true }).press("Enter");
  await page.getByRole("option", { name: "lab0", exact: true }).click();
  await route.getByLabel("Metric", { exact: true }).fill("0");
  await route.getByRole("button", { name: "Save", exact: true }).click();
  await expect(route.getByRole("alert")).toContainText("1..2147483647");
  await route.getByLabel("Metric", { exact: true }).fill("10");
  await route.getByRole("button", { name: "Save", exact: true }).click();
  await expect(route).toHaveCount(0);
  const created = page.getByRole("row").filter({ has: page.getByRole("cell", { name: "203.0.113.0/24", exact: true }) });
  await created.getByRole("button", { name: "Edit / stage", exact: true }).click();
  await expect(route.getByLabel("Metric", { exact: true })).toHaveValue("10");
  expect(await page.locator(".v-table__wrapper").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("route-inline.png"), fullPage: true, animations: "disabled" });
  await route.getByLabel("Metric", { exact: true }).fill("20");
  await route.getByRole("button", { name: "Save", exact: true }).click();
  await expect(created).toContainText("20");
  await navigate(page, "Gateway monitors");
  await expect(page.getByRole("region", { name: "Gateway monitors", exact: true }).getByRole("table")).toHaveCount(1);
  await expect(page.getByText("No gateway monitor records available.", { exact: true })).toHaveCount(0);
  await page.getByRole("region", { name: "Gateway monitors", exact: true }).getByRole("button", { name: "Edit / stage", exact: true }).click();
  const gateway = page.getByRole("row", { name: "Gateway monitor editor", exact: true });
  await expect(gateway).toBeVisible(); await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(gateway.getByLabel("Monitor name", { exact: true })).toHaveValue("uplink");
  await expect(page.getByLabel("Mean RTT degradation threshold (ms)", { exact: true })).toBeHidden();
  const targetBounds = await gateway.getByLabel("Probe Target", { exact: true }).boundingBox();
  const advancedBounds = await gateway.getByRole("button", { name: "Show advanced", exact: true }).boundingBox();
  expect(targetBounds).not.toBeNull();
  expect(advancedBounds).not.toBeNull();
  expect(advancedBounds!.x).toBeGreaterThanOrEqual(targetBounds!.x + targetBounds!.width);
  expect(advancedBounds!.y).toBeLessThan(targetBounds!.y + targetBounds!.height);
  expect(advancedBounds!.y + advancedBounds!.height).toBeGreaterThan(targetBounds!.y);
  await page.getByRole("button", { name: "Show advanced", exact: true }).click();
  await page.getByLabel("Mean RTT degradation threshold (ms)", { exact: true }).fill("175");
  await page.getByLabel("Failure hold (ms)", { exact: true }).fill("5000");
  await page.getByRole("button", { name: "Hide advanced", exact: true }).click();
  await expect(page.getByLabel("Failure hold (ms)", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Show advanced", exact: true }).click();
  await expect(page.getByLabel("Failure hold (ms)", { exact: true })).toHaveValue("5000");
  const table = page.getByRole("region", { name: "Gateway monitors", exact: true }).locator(".monitors-table > .v-table__wrapper");
  expect(await table.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.locator(".v-table tbody > tr, .v-table tbody > tr > td, .v-table tbody > tr > th").evaluateAll(elements => elements.every(element => {
    const style = getComputedStyle(element);
    return style.borderTopWidth === "0px" && style.borderBottomWidth === "0px";
  }))).toBe(true);
  expect(await table.locator("thead th").first().evaluate(element => getComputedStyle(element).borderBottomWidth)).toBe("1px");
  await page.screenshot({ path: testInfo.outputPath("gateway-inline.png"), fullPage: true, animations: "disabled" });
  await gateway.getByRole("button", { name: "Save", exact: true }).click();
  await expect(gateway).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Changes", exact: true })).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Enabled", exact: true })).toHaveCount(0);
  const enabled = page.getByRole("checkbox", { name: "Monitoring enabled for uplink", exact: true });
  await expect(enabled).toBeChecked();
  await enabled.uncheck(); await expect(enabled).not.toBeChecked();
  await enabled.check(); await expect(enabled).toBeChecked();
  expect(backend.writes).toHaveLength(0);
  await page.getByRole("region", { name: "Gateway monitors", exact: true }).getByRole("button", { name: "Edit / stage", exact: true }).click();
  await expect(page.getByLabel("Mean RTT degradation threshold (ms)", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Show advanced", exact: true }).click();
  await expect(page.getByLabel("Mean RTT degradation threshold (ms)", { exact: true })).toHaveValue("175");
  await expect(page.getByLabel("Failure hold (ms)", { exact: true })).toHaveValue("5000");
  await gateway.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("monitor editor keeps usable fields and compact actions when adding beside live metrics", async ({ page, isMobile }, testInfo) => {
  const initial = config(); initial.gateway_monitors = [{ ...monitor(), routing_table: 254 }];
  initial.routes[0]!.table = 254;
  const backend = await mockBackend(page, { initialConfig: initial });
  await connect(page); await navigate(page, "Gateway monitors");
  const monitors = page.getByRole("region", { name: "Gateway monitors", exact: true });
  const editor = monitors.getByRole("row", { name: "Gateway monitor editor", exact: true });
  const expectUsableEditor = async () => {
    const name = editor.getByLabel("Monitor name", { exact: true });
    const link = editor.getByLabel("Interface", { exact: true });
    const target = editor.getByLabel("Probe Target", { exact: true });
    for (const [field, minimumWidth] of [[name, 80], [link, 60], [target, 160]] as const) {
      await expect(field).toBeVisible();
      const width = await field.evaluate(element => element.closest(".v-input")!.getBoundingClientRect().width);
      expect(width).toBeGreaterThanOrEqual(minimumWidth);
    }
    for (const label of ["Save", "Cancel"]) {
      const button = editor.getByRole("button", { name: label, exact: true });
      await expect(button).toBeVisible();
      expect((await button.boundingBox())!.width).toBeLessThanOrEqual(100);
    }
    if (!isMobile) {
      const actions = await monitors.getByRole("columnheader", { name: "Actions", exact: true }).boundingBox();
      const save = await editor.getByRole("button", { name: "Save", exact: true }).boundingBox();
      expect(save!.x).toBeGreaterThanOrEqual(actions!.x);
      expect(save!.x + save!.width).toBeLessThanOrEqual(actions!.x + actions!.width);
    }
    expect(await monitors.locator(".v-table__wrapper").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  };
  await monitors.getByRole("button", { name: "Add monitor", exact: true }).click();
  await expectUsableEditor();
  await editor.getByLabel("Monitor name", { exact: true }).fill("backup");
  await editor.getByLabel("Interface", { exact: true }).press("Enter");
  await page.getByRole("option", { name: "lab0", exact: true }).click();
  await editor.getByLabel("Probe Target", { exact: true }).fill("198.51.100.1");
  await editor.getByRole("button", { name: "Show advanced", exact: true }).click();
  await expect(page.getByLabel("Probe interval (ms)", { exact: true })).toBeVisible();
  await expectUsableEditor();
  await page.screenshot({ path: testInfo.outputPath("monitor-add-layout.png"), fullPage: true, animations: "disabled" });
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toHaveCount(0);
  const created = monitors.getByRole("row").filter({ has: page.getByRole("button", { name: "Live statistics for backup", exact: true }) });
  await created.getByRole("button", { name: "Edit / stage", exact: true }).click();
  await expect(editor.getByLabel("Probe Target", { exact: true })).toHaveValue("198.51.100.1");
  await expectUsableEditor();
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(created).toBeVisible();
  expect(backend.writes).toHaveLength(0);
});

test("shared route draft preserves other subsystems and requires explicit apply and confirmation", async ({ page }, testInfo) => {
  const backend = await mockBackend(page);
  await connect(page);
  await expect(page.getByRole("button", { name: "Connected", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Save configuration", exact: true })).toHaveCount(0);
  await navigate(page, "Static Routes");
  await page.getByRole("button", { name: "Edit / stage", exact: true }).click();
  await page.getByLabel("Metric", { exact: true }).fill("42");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect(backend.writes).toHaveLength(0);
  await expect(page.getByRole("link", { name: "Save configuration", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("navbar-status.png"), fullPage: false, animations: "disabled" });
  expect(await page.getByRole("banner").getByRole("link", { name: "Modan モダン", exact: true }).evaluate(element => {
    const bounds = element.getBoundingClientRect(), banner = element.closest("header")!.getBoundingClientRect();
    return bounds.top >= banner.top && bounds.bottom <= banner.bottom;
  })).toBe(true);
  await page.getByRole("link", { name: "Save configuration", exact: true }).click();
  await expect(page).toHaveURL(/\/config\/changes$/);
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "Commit & push", exact: true }).click();
  expect(backend.writes).toHaveLength(0);
  await expect(page.getByRole("button", { name: "Push changes", exact: true })).toBeEnabled();
  await expect(page.getByRole("dialog").getByRole("checkbox")).toHaveCount(0);
  await page.getByLabel("Commit message", { exact: true }).fill("Update office route");
  await expect(page.getByRole("dialog").locator(".diff-file")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("push-dialog.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Push changes", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Confirm changes", exact: true })).toBeEnabled();
  await expect(page).toHaveURL(/\/config\/changes$/);
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.getByRole("dialog").getByRole("checkbox")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("confirm-in-push-dialog.png"), fullPage: true, animations: "disabled" });
  expect(backend.writes.filter(write => write.path === "/transactions")).toHaveLength(1);
  expect(backend.writes[0]?.body).toMatchObject({
    base_revision: "0", description: "Update office route", config: { routes: [{ table: 254, metric: 42 }], interfaces: [{ name: "lab0" }], softflowd: [{ name: "capture" }], kernel: { namespace: { "net.ipv4.tcp_syncookies": "1" } } },
  });
  expect(backend.writes.some(write => write.path.endsWith("/confirm"))).toBe(false);
  await page.getByRole("dialog").getByRole("button", { name: "Confirm changes", exact: true }).click();
  await expect(page).toHaveURL(/\/config\/commits\/[^/]+$/);
  await expect(page.getByRole("region", { name: "Commit detail", exact: true })).toContainText("committed");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Committed revision 1", exact: true })).toBeVisible();
  expect(backend.writes.filter(write => write.path.endsWith("/confirm"))).toHaveLength(1);
  expect(await page.evaluate(() => Object.values(localStorage))).toEqual(["11111111-1111-4111-8111-111111111111"]);
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
});

test("unknown write outcomes are frozen and never automatically replayed", async ({ page }) => {
  const backend = await mockBackend(page, { lostSubmit: true });
  await connect(page);
  await navigate(page, "Static Routes");
  await page.getByRole("button", { name: "Edit / stage", exact: true }).click();
  await page.getByLabel("Metric", { exact: true }).fill("99");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await navigate(page, "SAVE");
  await page.getByRole("button", { name: "Commit & push" }).click();
  await page.getByRole("button", { name: "Push changes", exact: true }).click();
  await expect(page.getByText("Outcome unknown: Apply package.", { exact: true })).toBeVisible();
  await page.waitForTimeout(1500);
  expect(backend.writes.filter(write => write.path === "/transactions")).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("only overview polls while other pages refresh on demand", async ({ page }) => {
  await page.clock.install();
  await mockBackend(page, { initialStatus: "pending_confirmation" });
  await connect(page);
  await navigate(page, "Commits");
  await page.locator(".section-content").getByRole("link", { name: "tx-test", exact: true }).click();
  const refreshTransaction = page.getByRole("button", { name: "Refresh commit", exact: true });
  await expect(refreshTransaction).toBeEnabled();
  const reads: string[] = [];
  page.on("request", request => {
    if (request.method() === "GET" && request.url().includes("/proxy/") && !request.url().includes("/system/upgrade")) reads.push(new URL(request.url()).pathname);
  });
  await page.clock.fastForward(20000);
  expect(reads).toHaveLength(0);
  await refreshTransaction.click();
  await expect.poll(() => reads.filter(path => path.endsWith("/transactions/tx-test")).length).toBe(1);
  await expect(refreshTransaction).toBeEnabled();
  await expect(page.getByRole("button", { name: "Refresh firewall state", exact: true })).toHaveCount(0);
  await navigate(page, "Static Routes");
  await expect(page.getByRole("region", { name: "Static Routes", exact: true })).toBeVisible();
  reads.length = 0;
  await page.clock.fastForward(20000);
  expect(reads.filter(path => !path.endsWith("/runtime"))).toHaveLength(0);
  await navigate(page, "Overview");
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await page.clock.fastForward(6000);
  await expect.poll(() => reads.some(path => path.endsWith("/statistics"))).toBe(true);
});

test("reload restores the registry session and rediscovers pending transactions", async ({ page }) => {
  let signIns = 0;
  page.on("request", request => { if (request.method() === "POST" && request.url().endsWith("/api/v1/session")) signIns++; });
  await mockBackend(page, { initialStatus: "pending_confirmation" }); await connect(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await expect(page.getByLabel("Registry admin password")).toHaveCount(0);
  await expect(page.getByRole("main")).toContainText("Overview");
  await navigate(page, "Commits");
  await expect(page.getByRole("main").getByRole("link", { name: "tx-test", exact: true })).toBeVisible();
  expect(signIns).toBe(1);
});

test("registry sign-out clears durable login and the remembered firewall", async ({ page }) => {
  await mockBackend(page); await connect(page);
  await page.getByRole("button", { name: "Connected", exact: true }).click();
  await page.getByRole("list", { name: "Registry session" }).getByText("Disconnect", { exact: true }).click();
  await page.getByRole("button", { name: "Disconnect and clear", exact: true }).click();
  await expect(page.getByLabel("Registry admin password")).toBeVisible();
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  await page.reload();
  await expect(page.getByLabel("Registry admin password")).toBeVisible();
});

test("an expired registry cookie requires login instead of reconnecting", async ({ page }) => {
  await mockBackend(page); await connect(page);
  await page.context().clearCookies();
  await page.reload();
  await expect(page.getByLabel("Registry admin password")).toBeVisible();
  await expect(page).toHaveURL(/\/connect\?redirect=/);
});

test("keyboard skip link, unknown routes, and exact statistics values", async ({ page }) => {
  await mockBackend(page);
  await connect(page);
  await expect(page.getByRole("cell", { name: "18.45 EB", exact: true })).toHaveAttribute("title", "18446744073709551615");
  await page.goto("/unknown-controller-page");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
});

test("ICMP false is staged explicitly and preserved with host/interface policy mode", async ({ page }) => {
  const initial = config(); initial.firewall.rules = []; initial.firewall.policies = { hosts: [], interfaces: [] };
  const backend = await mockBackend(page, { initialConfig: initial });
  await connect(page);
  await navigate(page, "Firewall forwarding");
  await expect(page.getByRole("main")).toContainText("Host/interface policy mode is active");
  await expect(page.getByLabel("Allow all IPv4 ICMP", { exact: true })).toHaveCount(0);
  await navigate(page, "General");
  await page.getByLabel("Allow all IPv4 ICMP", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect(backend.writes).toHaveLength(0);
  await navigate(page, "SAVE");
  await expect(page.getByRole("main")).toContainText("Allow all IPv4 ICMP");
  await page.getByRole("button", { name: "Commit & push" }).click();
  await page.getByRole("button", { name: "Push changes", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Confirm changes", exact: true })).toBeEnabled();
  expect(backend.writes[0]?.body).toMatchObject({ config: { firewall: { allow_all_icmp: false, policies: { hosts: [], interfaces: [] } } } });
  expect(backend.writes).toHaveLength(1);
});

test("host input stays separate and survives DHCP WAN full-package edits", async ({ page }, testInfo) => {
  const initial = config(), lan = initial.interfaces[0]!;
  initial.interfaces = [
    { name: "wan0", kind: "ethernet", role: "wan", mtu: 1500, up: true, addresses: [], dhcp_relay: { enabled: false, servers: [] } },
    { name: lan.name, kind: "ethernet", role: "lan", mtu: lan.mtu, up: true, addresses: lan.addresses, dhcp_relay: lan.dhcp_relay },
  ];
  initial.dhcp_clients = { wan0: { client_id: "", hostname: "", route_metric: 0, use_mtu: false, use_domains: "no" } };
  initial.firewall.allow_all_icmp = false;
  initial.firewall.rules = [];
  initial.firewall.policies = { hosts: [], interfaces: [{ interface: "lab0", rules: [{ action: "accept" }] }] };
  initial.firewall.nat.masquerade[0]!.out_interface = "wan0";
  initial.firewall.input = { policy: "drop", interfaces: [
    { interface: "wan0", rules: [{ destination: "0.0.0.0/0", protocol: "udp", destination_ports: [68], action: "accept" }] },
    { interface: "lab0", rules: [{ action: "accept" }] },
  ] };
  const backend = await mockBackend(page, { initialConfig: initial });
  await connect(page);
  await navigate(page, "Host input");
  const input = page.getByRole("region", { name: "Host input", exact: true });
  await expect(input).toContainText("established/related");
  await expect(input).toContainText("DHCP client");
  await expect(input).not.toContainText("IPv4 ICMP is accepted first");
  await navigate(page, "Static Routes");
  await page.getByRole("button", { name: "Edit / stage", exact: true }).click();
  await page.getByLabel("Metric", { exact: true }).fill("42");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await navigate(page, "Host input");
  await page.getByRole("button", { name: "Edit input policy", exact: true }).click();
  await page.getByLabel("Destination ports", { exact: true }).first().fill("68\n67");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(input).toContainText("68, 67");
  expect((await input.locator("tbody tr").first().boundingBox())!.height).toBeLessThanOrEqual(80);
  expect(await input.getByRole("cell", { name: "68, 67 · DHCP client", exact: true }).evaluate(element => getComputedStyle(element).whiteSpace)).toBe("nowrap");
  expect(backend.writes).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("host-input.png"), fullPage: true, animations: "disabled" });
  await navigate(page, "NAT masquerading");
  await page.getByRole("button", { name: "Edit / stage", exact: true }).click();
  await page.getByLabel("Managed egress with family address", { exact: true }).press("Enter");
  await expect(page.getByRole("option", { name: "wan0", exact: true })).toBeVisible();
  await page.getByRole("option", { name: "wan0", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await navigate(page, "SAVE");
  await expect(page.getByRole("main")).toContainText("Host input changes can block management access or DHCP renewal");
  await page.getByRole("button", { name: "Commit & push", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("firewall.write");
  const apply = page.getByRole("button", { name: "Push changes", exact: true });
  await expect(page.getByRole("dialog")).not.toContainText("These drop rules may block access to the firewall.");
  await expect(page.getByRole("dialog").getByRole("checkbox")).toHaveCount(0);
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Confirm changes", exact: true })).toBeEnabled();
  const expected = structuredClone(initial);
  expected.routes[0]!.metric = 42;
  expected.routes[0]!.table = 254;
  expected.firewall.input!.interfaces[0]!.rules[0]!.destination_ports = [68, 67];
  expect(backend.writes).toHaveLength(1);
  expect(backend.writes[0]?.body).toMatchObject({ config: expected });
  await page.getByRole("dialog").getByRole("button", { name: "Confirm changes", exact: true }).click();
  await expect(page).toHaveURL(/\/config\/commits\/[^/]+$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Committed revision 1", exact: true })).toBeVisible();
});

test("removing host input requires visible protection review and no immediate write", async ({ page }) => {
  const initial = config(); initial.firewall.input = { policy: "drop", interfaces: [] };
  const backend = await mockBackend(page, { initialConfig: initial });
  await connect(page); await navigate(page, "Host input");
  await page.getByRole("button", { name: "Edit input policy", exact: true }).click();
  await page.getByLabel("Input filtering", { exact: true }).uncheck();
  await expect(page.getByRole("dialog")).toContainText("Removing input filtering removes host protection, including WAN protection");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("main")).toContainText("No host input filter configured");
  await navigate(page, "SAVE");
  await expect(page.getByRole("main")).toContainText("Removing input filtering removes host protection, including WAN protection");
  expect(backend.writes).toHaveLength(0);
});

test("inline interface settings and multi-server relay stage together without auto-configuring networking", async ({ page }) => {
  const initial = config(); initial.interfaces[0] = { ...initial.interfaces[0]!, kind: "ethernet" };
  const backend = await mockBackend(page, { initialConfig: initial, discoveredInterfaces: [{ name: "lab0", kind: "ethernet", index: 2, mac: "02:00:00:00:00:02", mtu: 1500, up: true, addresses: ["192.0.2.10/24"], ownership: "managed" }] }); await connect(page);
  await navigate(page, "Physical interfaces");
  await page.getByRole("row", { name: /lab0/ }).first().click();
  await page.getByLabel("MTU", { exact: true }).fill("1450");
  await expect(page.getByLabel("Enable DHCPv4 relay", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("DHCPv4 relay servers", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await navigate(page, "DHCPv4 relay");
  await page.getByRole("button", { name: "Edit DHCP relay lab0", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("DHCPv4 relay servers", { exact: true }).fill("198.51.100.10, 198.51.100.20");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("checkbox", { name: "Relay enabled for lab0", exact: true }).check();
  expect(backend.writes).toHaveLength(0);
  await navigate(page, "SAVE");
  await expect(page.getByRole("main")).toContainText("briefly disrupt relay on other interfaces");
  await page.getByRole("button", { name: "Commit & push" }).click();
  await page.getByRole("button", { name: "Push changes", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Confirm changes", exact: true })).toBeEnabled();
  expect(backend.writes[0]?.body).toMatchObject({ config: {
    interfaces: [{ name: "lab0", role: "lan", mtu: 1450, dhcp_relay: { enabled: true, servers: ["198.51.100.10", "198.51.100.20"] } }],
    routes: config().routes, firewall: config().firewall,
  } });
});

test("relay repair is explicit, bodyless and keeps forbidden errors visible", async ({ page }) => {
  const initial = config(); initial.interfaces[0]!.dhcp_relay = { enabled: true, servers: ["198.51.100.10"] };
  initial.softflowd[0]!.enabled = true;
  const backend = await mockBackend(page, { initialConfig: initial, serviceDenied: true }); await connect(page);
  await navigate(page, "DHCPv4 relay");
  await expect(page.getByRole("checkbox", { name: "Relay enabled for lab0", exact: true })).toBeChecked();
  expect(backend.writes).toHaveLength(0);
  await expect(page.getByRole("button", { name: "Reconcile all managed services", exact: true })).toHaveCount(0);
  await page.goto("/services/maintenance");
  await page.getByRole("button", { name: "Reconcile all managed services", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("softflowd.write");
  await page.getByRole("button", { name: "Reconcile all services", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("HTTP 403: interfaces.write permission required");
  expect(backend.writes).toEqual([{ path: "/services/softflowd/reconcile", body: undefined }]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

async function navigate(page: Page, label: string): Promise<void> {
  const section = navigationSections.find(group => group.pages.some(entry => entry.title === label));
  if (!section) throw new Error(`Unknown navigation page: ${label}`);
  if (section.name === "overview-section") {
    await page.locator(".product-branding").click();
    return;
  }
  const pages = page.getByRole("navigation", { name: `${section.title} pages` });
  if (!await pages.isVisible()) {
    if (section.name === "config-section") {
      await page.getByRole("group", { name: "Firewall status" }).getByRole("link", { name: /^Committed revision / }).click();
    } else {
      await openNavigation(page);
      await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: section.title, exact: true }).click();
    }
  }
  if (section.pages.length > 1) {
    const expand = pages.getByRole("button", { name: /^Expand .* navigation$/ });
    if (await expand.isVisible()) await expand.click();
    await pages.getByRole("tab", { name: label, exact: true }).click();
  }
}

test("gateway create stages an explicit path and preserves complete package state", async ({ page }) => {
  const initial = config(); initial.routes[0]!.table = 254;
  const backend = await mockBackend(page, { initialConfig: initial }); await connect(page);
  await navigate(page, "Gateway monitors");
  await page.getByRole("button", { name: "Add monitor", exact: true }).click();
  await expect(page.getByRole("button", { name: "DHCP", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Probe interval (ms)", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Show advanced", exact: true }).click();
  await expect(page.getByLabel("Probe interval (ms)", { exact: true })).toHaveValue("1000");
  await page.getByRole("button", { name: "Hide advanced", exact: true }).click();
  await page.getByLabel("Monitor name", { exact: true }).fill("uplink");
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await page.getByLabel("Interface", { exact: true }).press("Enter");
  await page.getByRole("option", { name: "lab0", exact: true }).click();
  await expect(page.getByLabel("Gateway", { exact: true })).toHaveCount(0);
  await page.getByLabel("Probe Target", { exact: true }).fill("198.51.100.1");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(backend.writes).toHaveLength(0);
  await navigate(page, "SAVE");
  await page.getByRole("button", { name: "Commit & push" }).click();
  await expect(page.getByRole("dialog")).toContainText("gateway_monitors.write");
  await page.getByRole("button", { name: "Push changes", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Confirm changes", exact: true })).toBeEnabled();
  expect(backend.writes[0]?.body).toMatchObject({ config: { gateway_monitors: [{ ...monitor(), routing_table: 254 }], ntp: config().ntp, syslog: config().syslog, vnstat: config().vnstat, interfaces: config().interfaces } });
  expect(backend.writes).toHaveLength(1);
});

test("DHCP gateway monitor saves before a lease and displays live resolved paths without configuration pins", async ({ page }, testInfo) => {
  const initial = config(); initial.interfaces[0]!.kind = "ethernet"; initial.interfaces[0]!.addresses = []; initial.routes = [];
  initial.dhcp_clients = { lab0: { client_id: "", hostname: "", route_metric: 0, use_mtu: false, use_domains: "no" } };
  const waiting = { ...gatewayStatistics(), name: "wan-health", mode: "dhcp" as const, interface: "lab0", process_state: "waiting", sample_status: "waiting_for_dhcp", health: "unknown", resolved_source_address: null as string | null, resolved_gateway: null, resolved_routing_table: null as number | null, reason: "waiting for DHCP lease" as string | null, loss_percent: null, rtt_avg_ms: null, rtt_stddev_ms: null, rtt_min_ms: null, rtt_max_ms: null, rtt_p50_ms: null, rtt_p95_ms: null, rtt_variation_ms: null, sent: 0, received: 0, lost: 0, pending: 0, variation_pairs: 0 };
  const backend = await mockBackend(page, { initialConfig: initial, gatewayRows: [waiting], runtimeCapabilities: { gateway_monitor_modes: ["explicit", "dhcp"], dhcp_gateway_monitor_address_families: ["ipv4"] } });
  await connect(page); await navigate(page, "Gateway monitors");
  await page.getByRole("button", { name: "Add monitor", exact: true }).click();
  const editor = page.getByRole("row", { name: "Gateway monitor editor", exact: true });
  await editor.getByLabel("Monitor name", { exact: true }).fill("wan-health");
  await expect(editor.getByRole("button", { name: /^(Explicit|DHCP)$/ })).toHaveCount(0);
  await editor.getByLabel("Interface", { exact: true }).press("Enter");
  await page.getByRole("option", { name: "lab0", exact: true }).click();
  await editor.getByLabel("Probe Target", { exact: true }).fill("1.1.1.1");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("dhcp-monitor-editor.png"), fullPage: true, animations: "disabled" });
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toHaveCount(0); expect(backend.writes).toHaveLength(0);
  await navigate(page, "SAVE"); await page.getByRole("button", { name: "Commit & push" }).click();
  await expect(page.getByRole("dialog")).toContainText("gateway_monitors.write");
  await page.getByRole("button", { name: "Push changes", exact: true }).click();
  const confirm = page.getByRole("dialog").getByRole("button", { name: "Confirm changes", exact: true });
  await expect(confirm).toBeEnabled();
  const sent = backend.writes[0]!.body as { config: { gateway_monitors: Record<string, unknown>[]; interfaces: unknown; dhcp_clients: unknown; routes: unknown } };
  expect(sent.config.gateway_monitors[0]).toMatchObject({ name: "wan-health", mode: "dhcp", enabled: true, interface: "lab0", target: "1.1.1.1" });
  for (const key of ["source_address", "gateway", "routing_table"]) expect(sent.config.gateway_monitors[0]).not.toHaveProperty(key);
  expect(sent.config.interfaces).toEqual(initial.interfaces); expect(sent.config.dhcp_clients).toEqual(initial.dhcp_clients); expect(sent.config.routes).toEqual([]);
  await confirm.click(); await expect.poll(() => backend.writes.length).toBe(2);
  await expect(page).toHaveURL(/\/config\/commits\/[^/]+$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await navigate(page, "Gateway monitors");
  const monitors = page.getByRole("region", { name: "Gateway monitors", exact: true });
  const summary = monitors.getByRole("row").filter({ has: page.getByRole("button", { name: "Live statistics for wan-health", exact: true }) });
  await expect(summary).not.toContainText("Waiting for DHCP"); await expect(summary).not.toContainText("waiting for DHCP lease");
  await expect(summary.getByText("unknown", { exact: true })).toBeVisible();
  await expect(summary.locator('[data-metric="Mean RTT"]')).toContainText("Unavailable");
  await expect(page.getByRole("region", { name: "wan-health live statistics", exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("dhcp-monitor-waiting-statistics.png"), fullPage: true, animations: "disabled" });
  await monitors.getByRole("button", { name: "Live statistics for wan-health", exact: true }).click();
  const panel = page.getByRole("region", { name: "wan-health live statistics", exact: true });
  await expect(panel).toContainText("Waiting for DHCP"); await expect(panel).toContainText("waiting for DHCP lease");
  await expect(panel.getByText("unknown", { exact: true })).toBeVisible(); await expect(panel.getByText("down", { exact: true })).toHaveCount(0);
  Object.assign(waiting, { process_state: "running", sample_status: "warming_up", resolved_source_address: "192.0.2.20", resolved_routing_table: 20000, reason: null, collected_at: new Date().toISOString() });
  await expect(panel).toContainText("192.0.2.20"); await expect(panel).toContainText("Direct"); await expect(panel).toContainText("20000");
  expect(backend.writes).toHaveLength(2); expect(sent.config.gateway_monitors[0]).not.toHaveProperty("source_address");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await monitors.locator(".v-table__wrapper").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("dhcp-monitor-resolved.png"), fullPage: true, animations: "disabled" });
});

test("failed monitor push preserves long causes, operator prerequisites and the retained draft", async ({ page }, testInfo) => {
  const initial = config(); initial.routes[0]!.table = 254; initial.gateway_monitors = [{ ...monitor(), routing_table: 254 }];
  const cause = `apply failed: ${"native apply context: ".repeat(300)}gateway probes require explicit allow_gateway_monitoring opt-in; rollback detail retained`;
  const backend = await mockBackend(page, { initialConfig: initial, applyError: { message: cause, outcome: "rolled_back" } });
  await connect(page); await navigate(page, "Gateway monitors");
  await page.getByRole("button", { name: "Edit / stage", exact: true }).click();
  const editor = page.getByRole("row", { name: "Gateway monitor editor", exact: true });
  await editor.getByLabel("Probe Target", { exact: true }).fill("198.51.100.2");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await navigate(page, "SAVE"); await page.getByRole("button", { name: "Commit & push" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".monitor-prerequisites")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Push changes", exact: true }).click();
  const diagnostic = dialog.locator(".push-diagnostic");
  await expect(diagnostic).toContainText("gateway probes require explicit allow_gateway_monitoring opt-in; rollback detail retained");
  expect((await diagnostic.textContent())!.length).toBeGreaterThan(4096);
  await dialog.getByText("Gateway monitoring prerequisites", { exact: true }).click();
  const help = dialog.locator(".monitor-prerequisites");
  await expect(help).toHaveAttribute("open", "");
  await expect(help).toContainText("--allow-host-services"); await expect(help).toContainText("--gateway-monitoring");
  await expect(help).toContainText("no active transaction or upgrade"); await expect(help).toContainText("refresh committed state and revision");
  await help.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await dialog.locator(".v-card-text").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("monitor-failure-prerequisites.png"), fullPage: true, animations: "disabled" });
  expect(backend.writes).toHaveLength(1);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("main")).toContainText("198.51.100.2");
  expect(backend.writes).toHaveLength(1);
});

test("appliance settings share one draft and explain clock and local logger rollback risk", async ({ page }) => {
  const backend = await mockBackend(page); await connect(page);
  await navigate(page, "NTP");
  await expect(page.getByRole("main").getByRole("heading")).toHaveCount(0);
  await page.getByRole("button", { name: "Add NTP upstream server", exact: true }).click();
  await page.getByLabel("Host", { exact: true }).fill("clock.example");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("row", { name: /clock.example/ })).toBeVisible();
  await navigate(page, "Syslog");
  await expect(page.getByRole("main")).not.toContainText("Operator prerequisites");
  await page.getByRole("button", { name: "Add remote syslog server", exact: true }).click();
  await page.getByLabel("Host", { exact: true }).fill("logs.example");
  await page.getByLabel("Port", { exact: true }).fill("6514");
  await page.getByLabel("Transport", { exact: true }).press("Enter");
  await page.getByRole("option", { name: "TLS", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await navigate(page, "vnStat");
  await expect(page.getByRole("main")).not.toContainText("Operator prerequisites");
  await page.getByLabel("Desired enabled", { exact: true }).check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect(backend.writes).toHaveLength(0);
  await navigate(page, "SAVE");
  await expect(page.getByRole("main")).toContainText("whole appliance clock");
  await expect(page.getByRole("main")).toContainText("stop local system logging");
  await expect(page.getByRole("main")).toContainText("No HTTP historical metrics exist");
  await page.getByRole("button", { name: "Commit & push" }).click();
  await expect(page.getByRole("dialog")).toContainText("ntp.write, syslog.write, vnstat.write");
  await page.getByRole("button", { name: "Push changes", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Confirm changes", exact: true })).toBeEnabled();
  expect(backend.writes[0]?.body).toMatchObject({ config: {
    ntp: { enabled: true, servers: ["clock.example"] },
    syslog: { enabled: true, servers: [{ host: "logs.example", port: 6514, transport: "tls" }] },
    vnstat: { enabled: true }, routes: config().routes, gateway_monitors: [],
  } });
  expect(backend.writes).toHaveLength(1);
});

test("gateway fractional metrics, null gaps and stale health remain distinct", async ({ page }, testInfo) => {
  const initial = config(); initial.gateway_monitors = [monitor()];
  const row = gatewayStatistics(); row.rtt_variation_ms = null;
  row.collected_at = new Date(Date.now() - 10000).toISOString();
  await mockBackend(page, { initialConfig: initial, gatewayRows: [row] });
  await connect(page);
  await navigate(page, "Gateway monitors");
  const monitors = page.getByRole("region", { name: "Gateway monitors", exact: true });
  await expect(monitors.getByRole("table")).toHaveCount(1);
  const toggle = monitors.getByRole("button", { name: "Live statistics for uplink", exact: true });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  const monitorRow = monitors.getByRole("row").filter({ has: page.getByRole("button", { name: "Live statistics for uplink", exact: true }) });
  const summary = monitorRow;
  await expect(monitorRow).toContainText("uplink");
  await expect(monitorRow.getByRole("checkbox", { name: "Monitoring enabled for uplink", exact: true })).toBeVisible();
  const actions = monitorRow.getByRole("cell").filter({ has: page.getByRole("button", { name: "Edit / stage", exact: true }) });
  await expect(actions.getByRole("checkbox")).toHaveCount(0);
  await expect(monitorRow.getByRole("cell").nth(2).getByRole("checkbox")).toBeVisible();
  await expect(monitors.locator("tbody > tr")).toHaveCount(1);
  await expect(summary).toBeVisible(); await expect(summary).toContainText("33.33 %");
  await expect(summary).not.toContainText("no monitor sample");
  await expect(summary.locator('[data-metric="Loss"]')).toHaveAttribute("title", "33.33 %");
  await expect(summary).toContainText("1.25 ms"); await expect(summary).toContainText("RTT variation");
  await expect(summary).toContainText("Unavailable");
  await expect(monitors.getByRole("columnheader")).toHaveText(["Name", "Interface", "Status", "Health", "Loss", "Mean RTT", "Stddev", "RTT variation", "Actions"]);
  await expect(monitorRow.getByRole("cell")).toHaveCount(9);
  await expect(summary.locator('[data-metric="Health"] .v-chip')).toHaveText("unknown");
  await expect(summary.locator(".v-chip")).toHaveCount(5);
  for (const metric of ["Loss", "Mean RTT", "Stddev", "RTT variation"]) {
    await expect(summary.locator(`[data-metric="${metric}"] .v-chip`)).toHaveAttribute("aria-label", /Unrated/);
  }
  await expect(monitorRow).not.toContainText(initial.gateway_monitors[0]!.target);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("monitor-probe-statistics.png"), fullPage: true, animations: "disabled" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const panel = page.getByRole("region", { name: "uplink live statistics", exact: true });
  await expect(panel).toContainText("33.33 %");
  await expect(panel).toContainText("0 ms"); await expect(panel).toContainText("1.25 ms");
  await expect(panel).toContainText("Unavailable"); await expect(panel).toContainText("stale");
  await expect(panel).toContainText(initial.gateway_monitors[0]!.target);
  for (const label of ["Sample", "Sent", "Received", "Lost", "Pending"]) await expect(panel.locator("dt").getByText(label, { exact: true })).toBeVisible();
  await expect(panel.getByText("unknown", { exact: true })).toBeVisible();
  await expect(monitors.getByRole("table")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await monitors.locator(".v-table__wrapper").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("monitor-live-details.png"), fullPage: true, animations: "disabled" });
  await toggle.click();
  await expect(panel).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(summary).toBeVisible();
});

test("gateway metric chips show four quality bands without changing monitor health", async ({ page }, testInfo) => {
  const bands = [
    { name: "good", color: "green", loss: 0, latency: 99, spread: 9 },
    { name: "fair", color: "yellow", loss: 1, latency: 100, spread: 10 },
    { name: "warning", color: "orange", loss: 3, latency: 150, spread: 20 },
    { name: "poor", color: "red", loss: 5, latency: 300, spread: 30 },
  ];
  const initial = config();
  initial.gateway_monitors = bands.map(band => ({ ...monitor(), name: band.name, probe_interval_ms: 10000 }));
  await mockBackend(page, { initialConfig: initial, gatewayRows: bands.map(band => ({
    ...gatewayStatistics(), name: band.name, loss_percent: band.loss, rtt_avg_ms: band.latency,
    rtt_stddev_ms: band.spread, rtt_variation_ms: band.spread,
  })) });
  await connect(page); await navigate(page, "Gateway monitors");
  const monitors = page.getByRole("region", { name: "Gateway monitors", exact: true });
  for (const band of bands) {
    const row = monitors.getByRole("row").filter({ has: page.getByRole("button", { name: `Live statistics for ${band.name}`, exact: true }) });
    await expect(row.locator('[data-metric="Health"] .v-chip')).toHaveText("up");
    for (const metric of ["Loss", "Mean RTT", "Stddev", "RTT variation"]) {
      const chip = row.locator(`[data-metric="${metric}"] .v-chip`);
      await expect(chip).toHaveClass(new RegExp(`text-${band.color}\\b`));
      await expect(chip).toHaveAttribute("title", /Green <.*red >=/);
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await monitors.locator(".v-table__wrapper").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("monitor-metric-colors.png"), fullPage: true, animations: "disabled" });
  await navigate(page, "Overview");
  const gateways = page.getByRole("region", { name: "Gateways", exact: true });
  for (const band of bands) {
    const row = gateways.getByRole("row").filter({ has: page.getByRole("cell", { name: band.name, exact: true }) });
    for (const metric of ["Mean RTT", "Stddev", "Loss"]) {
      await expect(row.locator(`[data-metric="${metric}"] .v-chip`)).toHaveClass(new RegExp(`text-${band.color}\\b`));
    }
    await expect(row.locator("td:last-child .v-chip")).toHaveText("Online");
    await expect(row.locator("td:last-child .v-chip")).toHaveClass(/text-success/);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("overview-gateway-metric-colors.png"), fullPage: true, animations: "disabled" });
});

test("operational pages keep content compact with readable details", async ({ page }, testInfo) => {
  const backend = await mockBackend(page, { initialStatus: "committed" });
  await connect(page);
  for (const entry of navigationSections.flatMap(section => section.pages).filter(entry => entry.path !== "/overview")) {
    await navigate(page, entry.title);
    const main = page.getByRole("main");
    await expect(page).toHaveURL(new RegExp(`${entry.path}$`));
    await expect(main.getByRole("heading", { level: 1 })).toHaveCount(/^\/(settings|connections)/.test(entry.path) ? 1 : 0);
    await expect(main.locator("pre")).toHaveCount(0);
    await expect(main).not.toContainText("Operator prerequisites");
    await expect(main).not.toContainText("Last successful read");
    await expect(main).not.toContainText("Journal metadata is not a full audit-event log");
    await expect(main.locator(".filter-grid")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (["/services/syslog", "/firewall", "/config/revisions", "/config/changes"].includes(entry.path)) {
      await page.screenshot({ path: testInfo.outputPath(`${entry.name}-compact.png`), fullPage: true, animations: "disabled" });
    }
  }
  await page.getByRole("main").getByRole("link", { name: "0", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Revision 0", exact: true })).toBeVisible();
  await expect(page.locator("details").filter({ has: page.getByText("Configuration", { exact: true }) })).not.toHaveAttribute("open");
  await page.screenshot({ path: testInfo.outputPath("revision-compact.png"), fullPage: true, animations: "disabled" });
  await navigate(page, "Commits");
  await page.getByRole("main").getByRole("link", { name: "tx-test", exact: true }).click();
  await expect(page.getByRole("heading", { name: "tx-test", exact: true })).toBeVisible();
  await expect(page.getByRole("main").locator("pre")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("transaction-compact.png"), fullPage: true, animations: "disabled" });
  expect(backend.writes).toHaveLength(0);
});

test("appliance repair uses stored cross-service permissions and keeps 403 visible", async ({ page }) => {
  const initial = config(); initial.gateway_monitors = [monitor()]; initial.ntp = { enabled: true, servers: ["clock.example"] }; initial.vnstat.enabled = true;
  const backend = await mockBackend(page, { initialConfig: initial, serviceDenied: true }); await connect(page);
  await navigate(page, "NTP");
  await expect(page.getByRole("button", { name: "Reconcile all managed services", exact: true })).toHaveCount(0);
  await page.goto("/services/maintenance");
  await page.getByRole("button", { name: "Reconcile all managed services", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("gateway_monitors.write");
  await expect(page.getByRole("dialog")).toContainText("vnstat.write");
  await page.getByRole("button", { name: "Reconcile all services", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("HTTP 403");
  expect(backend.writes).toEqual([{ path: "/services/softflowd/reconcile", body: undefined }]);
});

test("new WireGuard tunnels are created only from their owning page", async ({ page }) => {
  const backend = await mockBackend(page); await connect(page); await navigate(page, "Tunnel interfaces");
  await page.getByRole("button", { name: "Add tunnel", exact: true }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("tun_wg0");
  await page.getByLabel("Private Key", { exact: true }).fill("new-tunnel-key");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("row", { name: /tun_wg0/ })).toContainText("51820");
  await navigate(page, "Physical interfaces");
  await expect(page.getByRole("link", { name: "tun_wg0", exact: true })).toHaveCount(0);
  await navigate(page, "WireGuard peers");
  await page.getByRole("button", { name: "Add peer", exact: true }).click();
  await page.getByLabel("Public key", { exact: true }).fill(btoa("\x01".repeat(32)));
  await page.getByLabel("Allowed networks (comma separated)", { exact: true }).fill("10.20.0.0/24");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: /^Details for tun_wg0/ }).click();
  await expect(page.getByRole("row").filter({ hasText: "Allowed networks" })).toContainText("10.20.0.0/24");
  expect(backend.writes).toHaveLength(0);
});

test("VLANs have a dedicated route while Interfaces edits physical behavior only", async ({ page, isMobile }, testInfo) => {
  const initial = config(); initial.interfaces[0] = { ...initial.interfaces[0]!, kind: "ethernet" };
  const existing = { ...initial.interfaces[0]!, name: "vlan10", kind: "vlan" as const, addresses: ["10.10.0.1/24"], vlan: { parent: "lab0", id: 10 } };
  initial.interfaces.push(existing);
  const backend = await mockBackend(page, { initialConfig: initial, discoveredInterfaces: [
    { name: "lab0", kind: "ethernet", index: 2, mac: null, mtu: 1500, up: true, addresses: initial.interfaces[0]!.addresses, ownership: "managed" },
    { name: "vlan10", kind: "vlan", index: 3, mac: null, mtu: 1500, up: true, addresses: existing.addresses, ownership: "managed" },
    { name: "unmanaged20", kind: "vlan", index: 4, mac: null, mtu: 1500, up: true, addresses: [], ownership: "unmanaged" },
  ] });
  await connect(page); await navigate(page, "VLANs");
  await expect(page.getByRole("columnheader", { name: "Parent", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "VLAN ID", exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "vlan10", exact: true })).toHaveCount(0);
  await page.goto("/vlans/vlan10");
  await expect(page).toHaveURL(/\/vlans\/vlan10$/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "vlan10", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "VLANs", exact: true })).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Edit / stage", exact: true }).click();
  await expect(page.getByLabel("VLAN ID", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Parent interface", { exact: true })).toBeDisabled();
  await page.getByLabel("MTU", { exact: true }).fill("1450");
  for (const label of ["VLAN ID", "MTU"]) {
    const width = (await page.getByLabel(label, { exact: true }).boundingBox())!.width;
    expect(width).toBeGreaterThanOrEqual(60);
    if (!isMobile) expect(width).toBeLessThanOrEqual(label === "VLAN ID" ? 120 : 90);
  }
  const vlanLabels = page.locator(".interface-editor-row .v-input").filter({ has: page.getByLabel("VLAN ID", { exact: true }) }).locator(".v-field-label");
  await expect.poll(() => vlanLabels.evaluateAll(labels => labels.length > 0 && labels.every(label => label.scrollWidth <= label.clientWidth))).toBe(true);
  await page.getByLabel("IPv4 addresses / prefixes", { exact: true }).fill("10.10.0.2/24");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await navigate(page, "Physical interfaces");
  await expect(page.getByRole("main").getByRole("link", { name: "vlan10", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Physical interfaces", exact: true })).not.toContainText("vlan10");
  await expect(page.getByRole("region", { name: "Physical interfaces", exact: true })).not.toContainText("unmanaged20");
  await expect(page.getByRole("button", { name: "Add interface", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Edit / stage", exact: true }).click();
  await expect(page.getByLabel("Kind", { exact: true })).toHaveCount(0);
  await page.getByLabel("MTU", { exact: true }).fill("1550");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await navigate(page, "VLANs");
  await expect(page.getByRole("main").getByRole("link", { name: "lab0", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Add VLAN", exact: true }).click();
  const editor = page.getByRole("row", { name: "VLAN editor", exact: true });
  await expect(editor).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(editor.locator("input")).toHaveCount(6);
  await expect.poll(() => vlanLabels.evaluateAll(labels => labels.length > 0 && labels.every(label => label.scrollWidth <= label.clientWidth))).toBe(true);
  await expect(page.getByLabel("Kind", { exact: true })).toHaveCount(0);
  await page.getByLabel("Interface name", { exact: true }).fill("vlan30");
  await page.getByLabel("Parent interface", { exact: true }).press("Enter");
  await page.getByRole("option", { name: "lab0", exact: true }).click();
  await page.getByLabel("VLAN ID", { exact: true }).fill("30");
  await expect(page.getByLabel("Interface address prefixes", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Enable DHCPv4 relay", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "vlan30", exact: true })).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("cell", { name: "vlan30", exact: true })).toBeVisible();
  const created = page.getByRole("row").filter({ has: page.getByRole("cell", { name: "vlan30", exact: true }) });
  await created.getByRole("button", { name: "Edit / stage", exact: true }).click();
  await page.getByLabel("IPv4 addresses / prefixes", { exact: true }).fill("10.30.0.1/24");
  expect(await page.locator(".v-table__wrapper").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("vlan-inline.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(created).toContainText("10.30.0.1/24");
  await expect(page.getByRole("columnheader", { name: "Changes", exact: true })).toHaveCount(0);
  await expect(created).not.toContainText("Unsaved");
  expect(await page.locator(".v-table__wrapper").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("vlans-page.png"), fullPage: true, animations: "disabled" });
  expect(backend.writes).toHaveLength(0);
  await navigate(page, "SAVE");
  await page.getByRole("button", { name: "Commit & push", exact: true }).click();
  await page.getByRole("button", { name: "Push changes", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Confirm changes", exact: true })).toBeEnabled();
  expect(backend.writes).toHaveLength(1);
  expect(backend.writes[0]?.body).toMatchObject({ config: {
    interfaces: [{ ...initial.interfaces[0], mtu: 1550 }, { ...existing, mtu: 1450, addresses: ["10.10.0.2/24"] }, { name: "vlan30", kind: "vlan", role: "unassigned", vlan: { parent: "lab0", id: 30 }, addresses: ["10.30.0.1/24"] }],
    routes: initial.routes, firewall: initial.firewall, softflowd: initial.softflowd,
  } });
});
