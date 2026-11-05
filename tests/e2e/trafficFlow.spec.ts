import { expect, test } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { trafficFlowCapabilities, trafficFlowConfig, trafficFlowStatistics } from "../trafficFlowFixtures";
import { gatewayStatistics, healthSnapshot, monitor, runtime } from "../fixtures";

test("Overview enlarges only the diagram to 140% at normal browser zoom", async ({ page, isMobile }) => {
  const initialConfig = trafficFlowConfig();
  initialConfig.interfaces = initialConfig.interfaces.filter(link => ["wan0", "lab0"].includes(link.name));
  await mockBackend(page, { initialConfig, statistics: trafficFlowStatistics() });
  await page.route("**/proxy/interface-capabilities", route => route.fulfill({
    contentType: "application/json", body: JSON.stringify(trafficFlowCapabilities()),
  }));
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const map = page.getByRole("region", { name: "Overview", exact: true });
  await expect(map.locator(".flow-node")).toHaveCount(2);
  await expect(map.locator(".flow-board")).toHaveCSS("zoom", "1.4");
  await expect(page.locator(".app-header")).toHaveCSS("zoom", "1");
  await expect(page.locator("html")).toHaveCSS("zoom", "1");
  for (const card of await map.locator(".flow-node").all()) {
    await expect.poll(async () => (await card.boundingBox())!.width).toBeCloseTo(441, 0);
  }
  const viewport = map.locator(".flow-viewport");
  const board = map.locator(".flow-board");
  const appliance = map.locator(".appliance");
  if (!isMobile) {
    await expect.poll(async () => (await appliance.boundingBox())!.width).toBeCloseTo(560, 0);
    await expect.poll(async () => Math.abs((await board.boundingBox())!.width - (await viewport.boundingBox())!.width)).toBeLessThanOrEqual(1);
  }
  const chassis = (await appliance.boundingBox())!, window = (await viewport.boundingBox())!;
  expect(chassis.x).toBeGreaterThanOrEqual(window.x);
  expect(chassis.x + chassis.width).toBeLessThanOrEqual(window.x + window.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
});

test("System Overview keeps rounded dashboard cards and readable tables on wide screens", async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, "This regression exercises available desktop space.");
  const initialConfig = trafficFlowConfig(), publicKey = "A".repeat(43) + "=";
  initialConfig.interfaces = initialConfig.interfaces.filter(link => ["wan0", "lab0"].includes(link.name));
  initialConfig.interfaces.push({
    name: "wg0", kind: "wireguard", role: "unassigned", mtu: 1420, up: true, addresses: [],
    dhcp_relay: { enabled: false, servers: [] },
    wireguard: { key_ref: "wg-key", listen_port: 51820, peers: [{
      public_key: publicKey, endpoint: "vpn.example.test:51820", allowed_ips: ["10.0.0.0/24"], persistent_keepalive_seconds: 25,
    }] },
  });
  initialConfig.gateway_monitors = ["PRIMARY-INTERNET", "BACKUP-INTERNET", "REMOTE-SITE"].map(name => ({ ...monitor(), name }));
  const backend = await mockBackend(page, { initialConfig, statistics: trafficFlowStatistics(), gatewayRows:
    initialConfig.gateway_monitors.map(item => ({ ...gatewayStatistics(), name: item.name, rtt_avg_ms: 22.42, rtt_stddev_ms: 4.09 })),
  });
  await page.route("**/proxy/runtime", route => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ ...runtime(), wireguard: [{
      interface: "wg0", public_key: null, listen_port: 51820, peers: [{
        public_key: publicKey, endpoint: "vpn.example.test:51820", last_handshake_unix_seconds: Math.floor(Date.now() / 1000) - 118,
        rx_bytes: "13950000", tx_bytes: "11650000",
      }],
    }] }),
  }));
  await page.setViewportSize({ width: 1728, height: 900 });
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("region", { name: "Overview", exact: true }).locator(".overview-widget")).toHaveCount(0);
  await page.goto("/diagnostics/system-overview");
  const map = page.getByRole("region", { name: "System overview", exact: true });
  const elevated = await page.locator(".app-header").evaluate(element => getComputedStyle(element).backgroundColor);
  for (const title of ["Interfaces", "Gateways", "WireGuard", "BGP peers", "System stats", "Interface counters"]) {
    const widget = map.getByRole("region", { name: title, exact: true });
    await expect(widget).toBeVisible();
    await expect(widget).toHaveCSS("background-color", elevated);
    await expect(widget).toHaveCSS("border-top-left-radius", "12px");
    await expect(widget).toHaveCSS("border-top-color", "rgb(48, 54, 61)");
  }
  await expect(map.getByRole("region", { name: "Gateways", exact: true })).toContainText("PRIMARY-INTERNET");
  await expect(map.getByRole("region", { name: "WireGuard", exact: true })).toContainText("13.95 MB");
  for (const size of [{ width: 1728, height: 900 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(size);
    await expect.poll(() => map.locator('[data-column="0"]').evaluate(element => element.clientWidth)).toBeGreaterThan(550);
    for (const table of await map.locator(".overview-widget .v-table__wrapper").all()) {
      expect(await table.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath("wide-dashboard-tables.png"), fullPage: true, animations: "disabled" });
  expect(backend.writes).toEqual([]);
});

test("Traffic flow depicts live north/south appliance traffic with accessible responsive controls", async ({ page, isMobile }, testInfo) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const initialConfig = trafficFlowConfig();
  initialConfig.interfaces.push(
    { ...initialConfig.interfaces[0]!, name: "disabled0", up: false },
    { ...initialConfig.interfaces[0]!, name: "down0" },
  );
  const backend = await mockBackend(page, { initialConfig });
  await page.route("**/proxy/interface-capabilities", route => route.fulfill({
    contentType: "application/json", body: JSON.stringify(trafficFlowCapabilities(100)),
  }));
  let reads = 0, hostReads = 0, failed = false;
  await page.route("**/proxy/statistics/host", route => {
    const index = hostReads++;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(
      healthSnapshot(String(100 + index * 25), String(100 + index * 75), 100 + index * 3),
    ) });
  });
  await page.route("**/proxy/statistics", route => {
    const sample = trafficFlowStatistics(reads * 3, BigInt(reads) * 3000000n);
    sample.interfaces.push({ ...sample.interfaces[0]!, name: "down0", oper_state: "DOWN" });
    reads++;
    return route.fulfill({
      status: failed ? 503 : 200, contentType: "application/json",
      body: failed ? '{"error":"Traffic counters temporarily unavailable"}' : JSON.stringify(sample),
    });
  });
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("region", { name: "Overview", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/overview$/);
  await page.goto("/diagnostics/traffic-flow");
  await expect(page).toHaveURL(/\/overview$/);
  const map = page.getByRole("region", { name: "Overview", exact: true });
  await expect(map.getByRole("img", { name: "Illustration of a firewall hardware appliance", exact: true })).toBeVisible();
  await expect(map.locator(".appliance-logo")).toBeVisible();
  await expect(map.locator(".flow-stream.is-moving")).toHaveCount(8, { timeout: 12000 });
  await expect(map.getByRole("article", { name: "wan0 interface counters", exact: true })).toContainText("8 Mb/s");
  await expect(map.locator(".node-rates").first().locator("div").last()).toHaveCSS("text-align", "right");
  await expect(map.getByRole("region", { name: "LAN interfaces", exact: true }).getByRole("article")).toHaveCount(3);
  await expect(map).toContainText("edge-fw-01");
  await expect(map.getByRole("region", { name: "Host performance", exact: true })).toContainText("25%");
  await expect(map.getByRole("region", { name: "Host performance", exact: true })).toContainText("75%");
  await expect(map.getByRole("article", { name: "disabled0 interface counters", exact: true })).toHaveCount(0);
  await expect(map.getByRole("article", { name: "down0 interface counters", exact: true })).toHaveCount(0);
  await expect(map.locator("footer, h1")).toHaveCount(0);
  await expect(map).not.toContainText("NETWORK IN MOTION");
  const surface = await page.locator(".section-layout").evaluate(element => getComputedStyle(element).backgroundColor);
  const elevated = await page.locator(".app-header").evaluate(element => getComputedStyle(element).backgroundColor);
  await expect(map).toHaveCSS("background-color", surface);
  await expect(map).toHaveCSS("background-image", "none");
  const hostPanel = map.getByRole("region", { name: "Host performance", exact: true });
  await expect(hostPanel).toHaveCSS("background-color", elevated);
  await expect(hostPanel).toHaveCSS("box-shadow", "none");
  await expect(hostPanel).toHaveCSS("border-top-width", "0px");
  await expect(map.locator(".appliance").getByRole("region", { name: "Host performance", exact: true })).toBeVisible();
  await expect(map.locator(".flow-heading")).toHaveCount(0);
  await expect(map.locator(".overview-widget")).toHaveCount(0);
  await expect(map.getByRole("button", { name: "Customize layout", exact: true })).toHaveCount(0);
  for (const card of await map.locator(".flow-node").all()) {
    await expect(card).toHaveCSS("background-color", elevated);
    await expect(card).toHaveCSS("background-image", "none");
  }
  await expect(map.locator(".appliance-halo")).toHaveCount(0);
  if (!isMobile) {
    const originalViewport = page.viewportSize()!;
    let compactLinkHeight = 0;
    for (const size of [{ width: 960, height: 720 }, { width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
      await page.setViewportSize(size);
      await expect.poll(async () => {
        const bounds = (await map.boundingBox())!;
        return Math.abs(bounds.y + bounds.height - (size.height - 12));
      }).toBeLessThanOrEqual(1);
      const bounds = (await map.boundingBox())!;
      expect(bounds.y).toBe(76);
      expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
      const panelBounds = (await hostPanel.boundingBox())!;
      const applianceBounds = (await map.locator(".appliance").boundingBox())!;
      expect(panelBounds.x).toBeGreaterThanOrEqual(applianceBounds.x);
      expect(panelBounds.x + panelBounds.width).toBeLessThanOrEqual(applianceBounds.x + applianceBounds.width + 1);
      for (const card of await map.locator(".flow-node").all()) {
        const cardBounds = (await card.boundingBox())!;
        expect(cardBounds.width).toBeLessThanOrEqual(315 * 1.4);
        expect(panelBounds.x >= cardBounds.x + cardBounds.width || panelBounds.x + panelBounds.width <= cardBounds.x ||
          panelBounds.y >= cardBounds.y + cardBounds.height || panelBounds.y + panelBounds.height <= cardBounds.y).toBe(true);
      }
      if (size.height === 720) compactLinkHeight = (await map.locator(".flow-links").first().boundingBox())!.height;
      if (size.height === 1080) {
        expect((await map.locator(".flow-links").first().boundingBox())!.height).toBeGreaterThan(compactLinkHeight);
        await page.screenshot({ path: testInfo.outputPath("traffic-flow-tall.png"), fullPage: true, animations: "disabled" });
      }
    }
    await page.setViewportSize(originalViewport);
  }
  const readings = (await hostPanel.boundingBox())!;
  const hardware = (await map.locator(".appliance svg").boundingBox())!;
  expect(readings.y).toBeGreaterThanOrEqual(hardware.y + hardware.height);
  const outboundLinks = (await map.locator(".flow-zone--lan .flow-links").boundingBox())!;
  expect(readings.y + readings.height).toBeLessThanOrEqual(outboundLinks.y);
  const wan = await map.getByRole("article", { name: "wan0 interface counters", exact: true }).boundingBox();
  const appliance = await map.locator(".appliance").boundingBox();
  expect(Math.abs(wan!.width - 315 * 1.4)).toBeLessThanOrEqual(1);
  const lan = await map.getByRole("article", { name: "lab0 interface counters", exact: true }).boundingBox();
  expect(wan!.y + wan!.height).toBeLessThan(appliance!.y);
  expect(lan!.y).toBeGreaterThan(appliance!.y + appliance!.height);
  const south = map.locator('[data-interface="wan0"][data-direction="southbound"]');
  const north = map.locator('[data-interface="wan0"][data-direction="northbound"]');
  await expect(south).toHaveAttribute("data-counter", "rx_bytes");
  await expect(north).toHaveAttribute("data-counter", "tx_bytes");
  await expect(south).toHaveCSS("animation-direction", "normal");
  await expect(north).toHaveCSS("animation-direction", "reverse");
  const rxDuration = await south.evaluate(element => Number.parseFloat(getComputedStyle(element).animationDuration));
  const txDuration = await north.evaluate(element => Number.parseFloat(getComputedStyle(element).animationDuration));
  expect(rxDuration).toBeLessThan(txDuration);
  expect(rxDuration).toBeGreaterThanOrEqual(0.65);
  expect(txDuration).toBeLessThan(6);
  const offset = await south.evaluate(element => getComputedStyle(element).strokeDashoffset);
  await expect.poll(() => south.evaluate(element => getComputedStyle(element).strokeDashoffset)).not.toBe(offset);
  await map.getByRole("button", { name: "Pause animation", exact: true }).click();
  await expect(map.locator(".flow-stream.is-moving")).toHaveCount(0);
  await map.getByRole("button", { name: "Resume animation", exact: true }).click();
  await expect(map.locator(".flow-stream.is-moving")).toHaveCount(8);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const viewport = map.locator(".flow-viewport");
  await viewport.evaluate(element => { element.scrollLeft = 0; });
  const earlierReads = reads;
  await expect.poll(() => reads, { timeout: 10000 }).toBeGreaterThan(earlierReads);
  expect(await viewport.evaluate(element => element.scrollLeft)).toBe(0);
  await viewport.evaluate(element => { element.scrollLeft = (element.scrollWidth - element.clientWidth) / 2; });
  const chassis = await map.locator(".appliance").boundingBox(), mapWindow = await viewport.boundingBox();
  expect(chassis!.x).toBeGreaterThanOrEqual(mapWindow!.x);
  expect(chassis!.x + chassis!.width).toBeLessThanOrEqual(mapWindow!.x + mapWindow!.width);
  await page.screenshot({ path: testInfo.outputPath("traffic-flow.png"), fullPage: true, animations: "disabled" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(south).toHaveCSS("animation-name", "none");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  failed = true;
  await expect(map).toContainText("Traffic counters temporarily unavailable", { timeout: 12000 });
  await expect(map.locator(".flow-stream.is-moving")).toHaveCount(0);
  await expect(map.getByRole("article", { name: "wan0 interface counters", exact: true })).toContainText("8 Mb/s");
  failed = false;
  await expect(map.locator(".flow-stream.is-moving")).toHaveCount(8, { timeout: 15000 });
  await map.getByRole("link", { name: "View traffic history for wan0", exact: true }).click();
  await expect(page).toHaveURL(/\/diagnostics\/traffic\?interface=wan0$/);
  await expect(page.getByRole("region", { name: "Real Time Traffic", exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Diagnostics pages" }).getByRole("tab", { name: "SYSTEM OVERVIEW", exact: true }).click();
  await expect(page).toHaveURL(/\/diagnostics\/system-overview$/);
  await expect(page.getByRole("region", { name: "System overview", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Customize layout", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "System stats", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "WireGuard", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Customize layout", exact: true }).click();
  await page.getByRole("button", { name: "Hide WireGuard", exact: true }).click();
  await page.getByRole("button", { name: "Save layout", exact: true }).click();
  await expect(page.getByRole("region", { name: "System overview", exact: true })).toContainText("Overview layout saved to the registry.");
  await page.reload();
  await expect(page.getByRole("region", { name: "WireGuard", exact: true })).toHaveCount(0);
  if (isMobile) await page.getByRole("button", { name: "Open navigation menu", exact: true }).click();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Services", exact: true }).click();
  const stoppedReads = reads;
  await page.waitForTimeout(6500);
  expect(reads).toBe(stoppedReads);
  expect(backend.writes).toEqual([]);
  expect(errors).toEqual([]);
});
