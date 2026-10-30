import { expect, test, type Page } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { hostPolicyConfig } from "../fixtures";

test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

async function expectFullHeightHosts(page: Page): Promise<void> {
  const hosts = page.getByRole("navigation", { name: "Hosts", exact: true });
  await expect.poll(() => hosts.evaluate(element => {
    const gutter = parseFloat(getComputedStyle(element.closest(".app-content")!).paddingTop);
    return Math.abs(element.getBoundingClientRect().bottom - (innerHeight - gutter));
  })).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
}

test("PROTECTED HOSTS browses searchable hosts without staging changes and fits compact screens", async ({ page, isMobile }, testInfo) => {
  const initialConfig = hostPolicyConfig();
  initialConfig.sando = { api_url: "https://sando.example", sync_enabled: true, hosts_import: null, rules_import: null };
  await page.route("https://sando.example/api/localhosts", route => route.fulfill({ json: [
    { ip_address: "192.0.2.20", local_description: "Unifi", device_type: "wifi_ap", icon: "WIFI_ACCESS_POINT", threat_score: 0 },
    { ip_address: "198.51.100.10", local_description: "Alpha server", icon: "Server", threat_score: 25 },
  ] }));
  const longDestination = "2001:db8:1234:5678:abcd:ef01:2345:6789/128";
  initialConfig.firewall.policies!.hosts[2]!.rules[0]!.destination = longDestination;
  initialConfig.firewall.policies!.hosts[2]!.rules[0]!.destination_ports = [53, 443, 5353, 8443, 12345, 54321, 65535];
  const backend = await mockBackend(page, { initialConfig });
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("region", { name: "Overview", exact: true })).toBeVisible();
  await page.goto("/firewall");
  const sectionNavigation = page.getByRole("navigation", { name: "Firewall/NAT pages" });
  if (!isMobile) {
    await expect(sectionNavigation.getByRole("tab")).toHaveCount(0);
    await sectionNavigation.getByRole("button", { name: "Expand Firewall/NAT navigation" }).click();
    await expect(sectionNavigation.getByRole("tab", { name: "PROTECTED HOSTS", exact: true })).toHaveAttribute("aria-current", "page");
    await expectFullHeightHosts(page);
    await sectionNavigation.getByRole("button", { name: "Collapse Firewall/NAT navigation" }).click();
    await expectFullHeightHosts(page);
  } else {
    await expect(sectionNavigation.getByRole("tab", { name: "PROTECTED HOSTS", exact: true })).toHaveAttribute("aria-current", "page");
  }
  const view = page.getByRole("region", { name: "PROTECTED HOSTS", exact: true });
  const table = view.getByRole("table", { name: "Host rules", exact: true });
  const hosts = view.getByRole("navigation", { name: "Hosts", exact: true });
  const hostButtons = hosts.getByRole("list").getByRole("button");
  await expect(hostButtons).toHaveText(["ALPHA SERVER", "PHONE", "UNIFI"]);
  const unifi = hosts.getByRole("button", { name: "UNIFI (192.0.2.20)", exact: true });
  await expect(hosts).toHaveCSS("background-color", "rgb(13, 17, 23)");
  await expect(hosts.locator(".search-field")).toHaveCSS("background-color", "rgb(22, 27, 34)");
  await expect(unifi).toHaveCSS("padding", "8px 16px");
  await expect(unifi).toHaveCSS("margin-bottom", "8px");
  await expect(unifi).toHaveCSS("color", "rgb(177, 184, 192)");
  await expect(unifi.locator(".icon-container")).toHaveCSS("width", "40px");
  await expect(unifi.locator(".device-icon")).toHaveAttribute("data-device-icon", "WIFI_ACCESS_POINT");
  await expect(unifi.locator(".device-icon")).toHaveCSS("width", "24px");
  await expect(unifi.locator(".device-icon")).toHaveCSS("height", "24px");
  await expect(unifi.locator(".device-icon")).toHaveCSS("color", "rgb(0, 200, 83)");
  await expect(hosts.locator('[data-device-icon="SERVER"]')).toHaveCSS("color", "rgb(255, 152, 0)");
  await expect(hosts.locator('[data-device-icon="DEFAULT"]')).toHaveCSS("color", "rgb(177, 184, 192)");
  await expect(unifi.locator(".host-info")).toHaveCSS("white-space", "nowrap");
  await expect(unifi.locator(".host-info")).toHaveCSS("text-overflow", "ellipsis");
  for (const icon of await hosts.locator(".device-icon").all()) {
    expect(await icon.evaluate(async element => {
      const image = new Image();
      image.src = getComputedStyle(element).maskImage.slice(4, -1).replace(/^["']|["']$/g, "");
      await image.decode();
      return image.naturalWidth > 0;
    })).toBe(true);
  }
  await unifi.click();
  await expect(unifi).toHaveCSS("background-color", "rgba(66, 165, 245, 0.2)");
  await expect(unifi).toHaveCSS("border-left", "3px solid rgb(66, 165, 245)");
  await expect(table.locator(".host-rule")).toHaveCount(4);
  await expect(table.locator(".host-rule").first().locator(".rule-value")).toHaveText(["1", "Any", "Server", "TCP", "443, 8443", "lab0", "accept"]);
  await expect(table.locator(".host-rule").last().locator(".rule-value")).toHaveText(["Default", "Any", "Any", "Any", "Any", "Any", "drop"]);
  await expect(table.locator(".host-rule").first().locator(".rule-action")).toHaveClass(/text-success/);
  await expect(table.locator(".host-rule").nth(1).locator(".rule-action")).toHaveClass(/text-error/);
  await expect(table.locator(".host-rule").first().locator(".v-chip")).toHaveText(["TCP", "443, 8443", "lab0", "accept"]);
  await expect(table.locator(".host-rule").last()).toHaveClass(/host-rule--default/);
  if (!isMobile) {
    const viewport = page.viewportSize()!;
    for (const width of [1024, 1280, 1600]) {
      await page.setViewportSize({ width, height: viewport.height });
      const row = table.locator(".host-rule").first();
      await expect(row).toHaveCSS("display", "table-row");
      await expect(table.getByRole("columnheader", { name: "Actions", exact: true })).toBeVisible();
      await expect(row.locator(".compact-cell-label").first()).toBeHidden();
      await expect(row.locator(".counter-label").first()).toBeHidden();
      expect((await row.boundingBox())!.height).toBeLessThanOrEqual(52);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.setViewportSize(viewport);
  }
  await expect(view.getByRole("button", { name: "Add rule", exact: true })).toBeVisible();
  await expect(view.getByRole("button", { name: "Save rule", exact: true })).toHaveCount(0);
  await expect(view.locator("pre")).toHaveCount(0);
  await hosts.getByRole("button", { name: "ALPHA SERVER (198.51.100.10)", exact: true }).click();
  await expect(table.locator(".host-rule")).toHaveCount(1);
  await expect(table.locator(".host-rule .rule-value")).toHaveText(["Default", "Any", "Any", "Any", "Any", "Any", "accept"]);
  await view.getByRole("textbox", { name: "Search hosts" }).fill("192.0.2.30");
  await expect(hostButtons).toHaveCount(1);
  await hosts.getByRole("button", { name: "PHONE (192.0.2.30)", exact: true }).click();
  await view.getByRole("textbox", { name: "Search hosts" }).fill("no matching host");
  await expect(hostButtons).toHaveCount(0);
  await expect(hosts).toContainText("No matching hosts.");
  if (!isMobile) await expectFullHeightHosts(page);
  await view.getByRole("textbox", { name: "Search hosts" }).fill("wifi_ap");
  await expect(hostButtons).toHaveCount(1);
  await expect(hostButtons).toContainText("UNIFI");
  await view.getByRole("textbox", { name: "Search hosts" }).fill("");
  await expect(table.locator(".host-rule")).toHaveCount(2);
  await expect(table.locator(".host-rule").first()).toContainText(longDestination);
  if (isMobile) {
    expect(await view.locator(".v-table__wrapper").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  } else {
    expect(await view.locator(".v-table__wrapper").evaluate(element => getComputedStyle(element).overflowX)).toBe("auto");
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const values = table.locator(".host-rule").first().locator(".rule-value");
  for (const value of await values.all()) {
    expect(await value.evaluate(element => element.getBoundingClientRect().right <= element.parentElement!.getBoundingClientRect().right)).toBe(true);
  }
  if (isMobile) {
    await expect(table.locator(".host-rule").first()).toHaveCSS("display", "grid");
    await expect(table.locator(".compact-cell-label").first()).toBeVisible();
    const cells = table.locator(".host-rule").first().locator("td");
    const ports = await cells.nth(4).boundingBox(), egress = await cells.nth(5).boundingBox();
    expect(ports!.y).toBe(egress!.y);
    expect(ports!.x + ports!.width).toBeLessThanOrEqual(egress!.x);
  }
  if (!isMobile) {
    const navigationBounds = await hosts.boundingBox(), tableBounds = await table.boundingBox();
    expect(navigationBounds!.x + navigationBounds!.width).toBeLessThanOrEqual(tableBounds!.x);
  }
  await page.screenshot({ path: testInfo.outputPath("host-rules.png"), fullPage: true, animations: "disabled" });
  expect(backend.writes).toEqual([]);
});

test("PROTECTED HOSTS fills the page height and matches Sando's scrollbar with an overflowing host list", async ({ page, isMobile }, testInfo) => {
  const initialConfig = hostPolicyConfig();
  const rule = initialConfig.firewall.policies!.hosts[2]!.rules[0]!;
  initialConfig.firewall.policies!.hosts = Array.from({ length: 35 }, (_, index) => ({
    id: `scroll_${index}`, name: `Long host description for scrolling ${String(index).padStart(2, "0")}`,
    addresses: [`192.0.2.${index + 1}`], policy: "drop",
    rules: !isMobile && index === 34 ? Array.from({ length: 40 }, () => ({ ...rule })) : [],
  }));
  const backend = await mockBackend(page, { initialConfig });
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("region", { name: "Overview", exact: true })).toBeVisible();
  await page.goto("/firewall");
  const hosts = page.getByRole("navigation", { name: "Hosts", exact: true });
  const list = hosts.getByRole("list");
  if (!isMobile) {
    const originalViewport = page.viewportSize()!;
    for (const viewport of [
      originalViewport, { width: 1600, height: 1000 }, { width: 1024, height: 768 }, { width: 1280, height: 480 },
    ]) {
      await page.setViewportSize(viewport);
      await expectFullHeightHosts(page);
      expect(await hosts.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    }
    await page.setViewportSize(originalViewport);
    await expectFullHeightHosts(page);
  }
  await expect(hosts.locator(".v-field__outline")).toHaveCSS("opacity", "0.3");
  await expect(hosts).toHaveCSS("scrollbar-width", "thin");
  await expect(hosts).toHaveCSS("scrollbar-color", "rgba(255, 255, 255, 0.1) rgba(0, 0, 0, 0)");
  const scrollbar = await hosts.evaluate(element => ({
    width: getComputedStyle(element, "::-webkit-scrollbar").width,
    height: getComputedStyle(element, "::-webkit-scrollbar").height,
    track: getComputedStyle(element, "::-webkit-scrollbar-track").backgroundColor,
    thumb: getComputedStyle(element, "::-webkit-scrollbar-thumb").backgroundColor,
    radius: getComputedStyle(element, "::-webkit-scrollbar-thumb").borderRadius,
    overflowing: element.scrollHeight > element.clientHeight,
  }));
  expect(scrollbar).toEqual({
    width: "6px", height: "6px", track: "rgba(0, 0, 0, 0)",
    thumb: "rgba(255, 255, 255, 0.1)", radius: "3px", overflowing: true,
  });
  const last = list.getByRole("button").last();
  await last.scrollIntoViewIfNeeded();
  expect(await hosts.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  const panelBounds = await hosts.boundingBox(), searchBounds = await hosts.locator(".search-container").boundingBox();
  expect(searchBounds!.y).toBeCloseTo(panelBounds!.y, 0);
  await last.click();
  await expect(last).toHaveAttribute("aria-current", "true");
  await expect(last.locator(".device-icon")).toHaveCSS("color", "rgb(177, 184, 192)");
  if (!isMobile) {
    const rules = page.locator(".host-policy-content");
    await expect(rules.locator(".host-rule")).toHaveCount(41);
    expect(await rules.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    const hostScrollTop = await hosts.evaluate(element => element.scrollTop);
    await rules.getByRole("row").last().scrollIntoViewIfNeeded();
    expect(await rules.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    expect(await hosts.evaluate(element => element.scrollTop)).toBe(hostScrollTop);
    await expectFullHeightHosts(page);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("host-list-scrollbar.png"), fullPage: true, animations: "disabled" });
  expect(backend.writes).toEqual([]);
});
