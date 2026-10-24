import { expect, test, type Page } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { config, gatewayStatistics, monitor, statistics } from "../fixtures";
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

test("top navigation opens routed sections in the black reference theme", async ({ page, isMobile }, testInfo) => {
  await mockBackend(page);
  await connect(page);
  await expect(page.locator(".v-navigation-drawer")).toHaveCount(0);
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  for (const section of navigationSections) {
    await openNavigation(page);
    await navigation.getByRole("link", { name: section.title, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${section.pages[0]!.path}$`));
    const pages = page.getByRole("navigation", { name: `${section.title} pages` });
    if (section.pages.length === 1) {
      await expect(pages).toHaveCount(0);
      const layout = await page.locator(".section-layout").boundingBox();
      const content = await page.locator(".section-content").boundingBox();
      expect(content!.width).toBe(layout!.width);
      expect(content!.x).toBe(layout!.x);
      await page.screenshot({ path: testInfo.outputPath("overview.png"), fullPage: true, animations: "disabled" });
      continue;
    }
    await expect(pages.getByRole("tab")).toHaveCount(section.pages.length);
    for (const entry of section.pages) {
      await pages.getByRole("tab", { name: entry.title, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${entry.path}$`));
      await expect(pages.getByRole("tab", { name: entry.title, exact: true })).toHaveAttribute("aria-current", "page");
    }
  }
  await navigate(page, "Interfaces");
  await openNavigation(page);
  await expect(navigation.getByRole("link", { name: "Networking", exact: true })).toHaveAttribute("aria-current", "page");
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
  const tabs = page.getByRole("navigation", { name: "Networking pages" }).getByRole("tablist");
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
    const rail = await page.locator(".section-navigation").boundingBox();
    const layout = await page.locator(".section-layout").boundingBox();
    expect(rail!.width / layout!.width).toBeCloseTo(0.25, 2);
  }
  await page.screenshot({ path: testInfo.outputPath("networking-section.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await page.getByRole("list", { name: "Registry session" }).getByText("Disconnect", { exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Disconnect and clear local state?");
  await page.getByRole("button", { name: "Keep connected", exact: true }).click();
});

test("compact overview contains four live status widgets without diagnostic clutter", async ({ page, isMobile }, testInfo) => {
  const initial = config(), counters = statistics();
  initial.gateway_monitors = [monitor()];
  initial.interfaces.push({
    name: "wg0", kind: "wireguard", role: "wan", mtu: 1420, up: true, addresses: ["10.0.0.1/24"], dhcp_relay: { enabled: false, servers: [] },
    wireguard: { key_ref: "wg-key", listen_port: 51820, peers: [] },
  });
  counters.sample.status = "available";
  counters.interfaces[0]!.status = "available"; counters.interfaces[0]!.oper_state = "UP";
  counters.interfaces.push({ name: "wg0", kind: "wireguard", ownership: "managed", mtu: 1420, admin_up: true, oper_state: "UP", status: "available", counters: { rx_packets: "125", tx_packets: "245", rx_bytes: "42100", tx_bytes: "84200", rx_errors: "0", tx_errors: "0" } });
  const backend = await mockBackend(page, { initialConfig: initial, statistics: counters });
  await connect(page);
  const dashboard = page.getByRole("region", { name: "Overview", exact: true });
  await expect(dashboard.getByRole("heading", { level: 2 })).toHaveText(["Interfaces", "Gateways", "WireGuard", "Interface counters"]);
  await expect(dashboard.getByRole("region", { name: "Interfaces", exact: true }).getByRole("cell", { name: "Up", exact: true })).toHaveCount(2);
  await expect(dashboard.getByRole("region", { name: "Interface counters", exact: true }).getByRole("cell", { name: "18446744073709551615", exact: true })).toBeVisible();
  await expect(dashboard.getByRole("region", { name: "WireGuard", exact: true })).toContainText("51820");
  await expect(dashboard.getByRole("region", { name: "Gateways", exact: true })).toContainText("Simulated");
  await expect(dashboard).not.toContainText("Recent transactions");
  expect(backend.writes).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const interfaces = await dashboard.getByRole("region", { name: "Interfaces", exact: true }).boundingBox();
  const counts = await dashboard.getByRole("region", { name: "Interface counters", exact: true }).boundingBox();
  if (isMobile) expect(counts!.y).toBeGreaterThan(interfaces!.y);
  else expect(counts!.y).toBe(interfaces!.y);
  await page.screenshot({ path: testInfo.outputPath("compact-overview.png"), fullPage: true, animations: "disabled" });
});

test("section pages support direct detail links and browser history", async ({ page }) => {
  await mockBackend(page);
  await page.goto("/interfaces/lab0");
  await signInToRegistry(page);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("heading", { name: "lab0", exact: true })).toBeVisible();
  const pages = page.getByRole("navigation", { name: "Networking pages" });
  await expect(pages.getByRole("tab", { name: "Interfaces", exact: true })).toHaveAttribute("aria-current", "page");
  await pages.getByRole("tab", { name: "Routes", exact: true }).click();
  await expect(page).toHaveURL(/\/routes$/);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "lab0", exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("region", { name: "Routes", exact: true })).toBeVisible();
  await navigate(page, "softflowd");
  await page.locator(".section-content").getByRole("link", { name: "capture", exact: true }).click();
  await expect(page).toHaveURL(/\/services\/softflowd\/capture$/);
  await expect(page.getByRole("heading", { name: "capture", exact: true })).toBeVisible();
  await navigate(page, "Committed revisions");
  await page.locator(".section-content").getByRole("link", { name: "0", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Revision 0", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Changes & history pages" }).getByRole("tab", { name: "Committed revisions", exact: true })).toHaveAttribute("aria-current", "page");
});

test("interfaces show one readable current configuration without duplicate diagnostics", async ({ page }, testInfo) => {
  const initial = config(), original = initial.interfaces[0]!;
  initial.interfaces = ["eno1", "enp3s0", "wlp1s0"].map((name, index) => ({ ...original, name, kind: "ethernet", role: "unassigned", addresses: index === 0 ? ["172.16.10.2/24"] : [] }));
  initial.routes = []; initial.policy_rules = []; initial.softflowd = []; initial.firewall.nat.masquerade = [];
  const discovered = initial.interfaces.map((link, index) => ({ name: link.name, kind: link.kind, index: index + 2, mac: "02:00:00:00:00:01", mtu: link.mtu, up: link.up, addresses: link.addresses, ownership: "managed" as const }));
  const backend = await mockBackend(page, { initialConfig: initial, discoveredInterfaces: discovered });
  await connect(page); await navigate(page, "Interfaces");
  const view = page.getByRole("region", { name: "Interfaces", exact: true });
  await expect(view.getByRole("heading")).toHaveCount(0);
  await expect(view.getByRole("table")).toHaveCount(1);
  await expect(view.getByRole("row")).toHaveCount(4);
  await expect(view.getByRole("cell", { name: "172.16.10.2/24", exact: true })).toBeVisible();
  await expect(view.getByRole("textbox")).toHaveCount(0);
  await expect(view.getByRole("combobox")).toHaveCount(0);
  await expect(view).not.toContainText("Show staged draft");
  await expect(view).not.toContainText("Discovered interfaces");
  await expect(view).not.toContainText("DHCPv4 leases");
  await expect(view).not.toContainText("Full configured");
  await expect(view.getByRole("table")).not.toContainText("[");
  await expect(view.getByRole("table")).not.toContainText("{");
  expect(await view.getByRole("cell", { name: "eno1", exact: true }).evaluate(element => getComputedStyle(element).whiteSpace)).toBe("nowrap");
  expect((await view.getByRole("row").filter({ hasText: "eno1" }).boundingBox())!.height).toBeLessThanOrEqual(80);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("interfaces-clean.png"), fullPage: true, animations: "disabled" });
  const row = view.getByRole("row").filter({ hasText: "eno1" });
  await row.getByRole("button", { name: "Edit / stage", exact: true }).click();
  await page.getByLabel("Required interface role").press("ArrowDown");
  await page.getByRole("option", { name: "WAN", exact: true }).click();
  await page.getByRole("button", { name: "Stage changes", exact: true }).click();
  await expect(row.getByRole("cell", { name: "WAN", exact: true })).toBeVisible();
  await expect(row).toContainText("Unsaved");
  await navigate(page, "Routes"); await navigate(page, "Interfaces");
  await expect(row.getByRole("cell", { name: "WAN", exact: true })).toBeVisible();
  expect(backend.writes).toHaveLength(0);
});

test("host NIC discovery stages Ethernet DHCP and DNS without live writes", async ({ page }, testInfo) => {
  const initial = config();
  initial.interfaces[0] = { ...initial.interfaces[0]!, kind: "ethernet", role: "unassigned" };
  const backend = await mockBackend(page, { initialConfig: initial, discoveredInterfaces: [{
    name: "eth1", kind: "ethernet", index: 3, mac: "02:00:00:00:00:03", mtu: 1500,
    up: true, addresses: ["192.0.2.99/24"], ownership: "unmanaged",
  }] });
  await connect(page);
  await navigate(page, "Interfaces");
  await expect(page.getByRole("cell", { name: "Unassigned", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Manage this interface", exact: true }).click();
  await expect(page.getByLabel("Interface address prefixes", { exact: true })).toHaveValue("");
  await page.getByLabel("Required interface role", { exact: true }).press("ArrowDown");
  await page.getByRole("option", { name: "Unassigned", exact: true }).click();
  await page.getByLabel("IPv4 configuration", { exact: true }).press("ArrowDown");
  await page.getByRole("option", { name: "dhcp", exact: true }).click();
  await page.getByLabel("Configure interface resolver", { exact: true }).check();
  await page.getByLabel("DNS server IP addresses", { exact: true }).fill("192.0.2.53");
  await page.getByRole("button", { name: "Stage changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(backend.writes).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo(0, 0); });
  await page.screenshot({ path: testInfo.outputPath("host-interfaces.png"), fullPage: true });
  await navigate(page, "Review changes");
  await expect(page.getByRole("main")).toContainText("dhcp_clients");
  await expect(page.getByRole("main")).toContainText("dns");
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
  await expect(page.getByRole("img", { name: "Observation unavailable", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("shared route draft preserves other subsystems and requires explicit apply and confirmation", async ({ page }, testInfo) => {
  const backend = await mockBackend(page);
  await connect(page);
  await expect(page.getByRole("img", { name: "Connected", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save configuration", exact: true })).toHaveCount(0);
  await navigate(page, "Routes");
  await page.getByRole("button", { name: "Edit / stage", exact: true }).click();
  await page.getByLabel("Metric", { exact: true }).fill("42");
  await page.getByRole("button", { name: "Stage changes", exact: true }).click();
  expect(backend.writes).toHaveLength(0);
  await expect(page.getByRole("button", { name: "Save configuration", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("navbar-status.png"), fullPage: false, animations: "disabled" });
  expect(await page.getByRole("banner").getByRole("link", { name: "Firewall Controller", exact: true }).evaluate(element => {
    const bounds = element.getBoundingClientRect(), banner = element.closest("header")!.getBoundingClientRect();
    return bounds.top >= banner.top && bounds.bottom <= banner.bottom;
  })).toBe(true);
  await page.getByRole("button", { name: "Save configuration", exact: true }).click();
  expect(backend.writes).toHaveLength(0);
  await expect(page.getByRole("button", { name: "Apply provisionally", exact: true })).toBeDisabled();
  await page.getByLabel("I reviewed the complete package, deletion impact, disruption risk, deadline, and recovery prerequisites.").check();
  await page.getByRole("button", { name: "Apply provisionally", exact: true }).click();
  await expect(page.getByRole("main")).toContainText("pending_confirmation");
  expect(backend.writes.filter(write => write.path === "/transactions")).toHaveLength(1);
  expect(backend.writes[0]?.body).toMatchObject({
    base_revision: "0", config: { routes: [{ metric: 42 }], interfaces: [{ name: "lab0" }], softflowd: [{ name: "capture" }], kernel: { namespace: { "net.ipv4.tcp_syncookies": "1" } } },
  });
  expect(backend.writes.some(write => write.path.endsWith("/confirm"))).toBe(false);
  await page.getByRole("button", { name: "Confirm configuration", exact: true }).first().click();
  await page.getByLabel("I have checked connectivity and want to commit this candidate.").check();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm configuration", exact: true }).click();
  await expect(page.getByRole("link", { name: "Committed revision 1", exact: true })).toBeVisible();
  expect(backend.writes.filter(write => write.path.endsWith("/confirm"))).toHaveLength(1);
  expect(await page.evaluate(() => Object.values(localStorage))).toEqual(["11111111-1111-4111-8111-111111111111"]);
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
});

test("unknown write outcomes are frozen and never automatically replayed", async ({ page }) => {
  const backend = await mockBackend(page, { lostSubmit: true });
  await connect(page);
  await navigate(page, "Routes");
  await page.getByRole("button", { name: "Edit / stage", exact: true }).click();
  await page.getByLabel("Metric", { exact: true }).fill("99");
  await page.getByRole("button", { name: "Stage changes", exact: true }).click();
  await navigate(page, "Review changes");
  await page.getByRole("button", { name: "Review provisional apply" }).click();
  await page.getByLabel("I reviewed the complete package, deletion impact, disruption risk, deadline, and recovery prerequisites.").check();
  await page.getByRole("button", { name: "Apply provisionally", exact: true }).click();
  await expect(page.getByText("Outcome unknown: Apply package.", { exact: true })).toBeVisible();
  await page.waitForTimeout(1500);
  expect(backend.writes.filter(write => write.path === "/transactions")).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("only overview polls while other pages refresh on demand", async ({ page }) => {
  await page.clock.install();
  await mockBackend(page, { initialStatus: "pending_confirmation" });
  await connect(page);
  await navigate(page, "Transactions");
  await page.locator(".section-content").getByRole("link", { name: "tx-test", exact: true }).click();
  const refreshTransaction = page.getByRole("button", { name: "Refresh transaction", exact: true });
  await expect(refreshTransaction).toBeEnabled();
  const reads: string[] = [];
  page.on("request", request => {
    if (request.method() === "GET" && request.url().includes("/proxy/")) reads.push(new URL(request.url()).pathname);
  });
  await page.clock.fastForward(20000);
  expect(reads).toHaveLength(0);
  await refreshTransaction.click();
  await expect.poll(() => reads.filter(path => path.endsWith("/transactions/tx-test")).length).toBe(1);
  await expect(refreshTransaction).toBeEnabled();
  await page.getByRole("button", { name: "Refresh firewall state", exact: true }).click();
  await expect.poll(() => reads.some(path => path.endsWith("/state"))).toBe(true);
  await expect(page.getByRole("button", { name: "Refresh firewall state", exact: true })).toBeEnabled();
  await navigate(page, "Routes");
  await expect(page.getByRole("region", { name: "Routes", exact: true })).toBeVisible();
  reads.length = 0;
  await page.clock.fastForward(20000);
  expect(reads).toHaveLength(0);
  await openNavigation(page);
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Overview", exact: true }).click();
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
  await expect(page.getByRole("main")).toContainText("pending confirmation");
  expect(signIns).toBe(1);
});

test("registry sign-out clears durable login and the remembered firewall", async ({ page }) => {
  await mockBackend(page); await connect(page);
  await page.getByRole("button", { name: "Profile", exact: true }).click();
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
  await expect(page.getByRole("cell", { name: "18446744073709551615", exact: true })).toBeVisible();
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
  await page.getByLabel("Allow all IPv4 ICMP", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Stage ICMP change", exact: true }).click();
  expect(backend.writes).toHaveLength(0);
  await navigate(page, "Review changes");
  await expect(page.getByRole("main")).toContainText("Allow all IPv4 ICMP");
  await page.getByRole("button", { name: "Review provisional apply" }).click();
  await page.getByLabel("I reviewed the complete package, deletion impact, disruption risk, deadline, and recovery prerequisites.").check();
  await page.getByRole("button", { name: "Apply provisionally", exact: true }).click();
  await expect(page.getByRole("main")).toContainText("pending_confirmation");
  expect(backend.writes[0]?.body).toMatchObject({ config: { firewall: { allow_all_icmp: false, policies: { hosts: [], interfaces: [] } } } });
  expect(backend.writes).toHaveLength(1);
});

test("WAN role and multi-server relay stage together without auto-configuring networking", async ({ page }) => {
  const backend = await mockBackend(page); await connect(page);
  await navigate(page, "Interfaces");
  await page.getByRole("button", { name: "Edit / stage", exact: true }).click();
  await page.getByLabel("Required interface role", { exact: true }).press("Enter");
  await page.getByRole("option", { name: "WAN", exact: true }).click();
  await page.getByLabel("Enable DHCPv4 relay", { exact: true }).check();
  await page.getByLabel("DHCPv4 relay servers", { exact: true }).fill("198.51.100.10\n198.51.100.20");
  await expect(page.getByRole("dialog")).toContainText("Selected DHCP relay address/subnet: 192.0.2.10/24");
  await page.getByRole("button", { name: "Stage changes", exact: true }).click();
  expect(backend.writes).toHaveLength(0);
  await navigate(page, "Review changes");
  await expect(page.getByRole("main")).toContainText("Role LAN to WAN (metadata only)");
  await expect(page.getByRole("main")).toContainText("briefly disrupt relay on other interfaces");
  await page.getByRole("button", { name: "Review provisional apply" }).click();
  await page.getByLabel("I reviewed the complete package, deletion impact, disruption risk, deadline, and recovery prerequisites.").check();
  await page.getByRole("button", { name: "Apply provisionally", exact: true }).click();
  await expect(page.getByRole("main")).toContainText("pending_confirmation");
  expect(backend.writes[0]?.body).toMatchObject({ config: {
    interfaces: [{ name: "lab0", role: "wan", dhcp_relay: { enabled: true, servers: ["198.51.100.10", "198.51.100.20"] } }],
    routes: config().routes, firewall: config().firewall,
  } });
});

test("relay repair is explicit, bodyless and keeps forbidden errors visible", async ({ page }) => {
  const initial = config(); initial.interfaces[0]!.dhcp_relay = { enabled: true, servers: ["198.51.100.10"] };
  initial.softflowd[0]!.enabled = true;
  const backend = await mockBackend(page, { initialConfig: initial, serviceDenied: true }); await connect(page);
  await navigate(page, "DHCPv4 relay");
  await expect(page.getByRole("main")).toContainText("Simulated");
  expect(backend.writes).toHaveLength(0);
  await page.getByRole("button", { name: "Reconcile all managed services", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("softflowd.write");
  await page.getByRole("button", { name: "Reconcile all services", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("HTTP 403: interfaces.write permission required");
  expect(backend.writes).toEqual([{ path: "/services/dhcp-relay/reconcile", body: undefined }]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

async function navigate(page: Page, label: string): Promise<void> {
  const section = navigationSections.find(group => group.pages.some(entry => entry.title === label));
  if (!section) throw new Error(`Unknown navigation page: ${label}`);
  const pages = page.getByRole("navigation", { name: `${section.title} pages` });
  if (!await pages.isVisible()) {
    await openNavigation(page);
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: section.title, exact: true }).click();
  }
  await pages.getByRole("tab", { name: label, exact: true }).click();
}

test("gateway create stages an explicit path and preserves complete package state", async ({ page }) => {
  const backend = await mockBackend(page); await connect(page);
  await navigate(page, "Gateway monitors");
  await page.getByRole("button", { name: "Add monitor", exact: true }).click();
  await page.getByLabel("Monitor name", { exact: true }).fill("uplink");
  await page.getByLabel("Desired monitoring enabled", { exact: true }).check();
  await page.getByLabel("Explicit managed interface", { exact: true }).fill("lab0");
  await page.getByLabel("Numeric source address", { exact: true }).fill("192.0.2.10");
  await page.getByLabel("Numeric gateway", { exact: true }).fill("198.51.100.1");
  await page.getByLabel("Numeric probe target", { exact: true }).fill("198.51.100.1");
  await page.getByRole("button", { name: "Stage changes", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(backend.writes).toHaveLength(0);
  await navigate(page, "Review changes");
  await page.getByRole("button", { name: "Review provisional apply" }).click();
  await expect(page.getByRole("dialog")).toContainText("gateway_monitors.write");
  await page.getByLabel("I reviewed the complete package, deletion impact, disruption risk, deadline, and recovery prerequisites.").check();
  await page.getByRole("button", { name: "Apply provisionally", exact: true }).click();
  await expect(page.getByRole("main")).toContainText("pending_confirmation");
  expect(backend.writes[0]?.body).toMatchObject({ config: { gateway_monitors: [monitor()], ntp: config().ntp, syslog: config().syslog, vnstat: config().vnstat, interfaces: config().interfaces } });
  expect(backend.writes).toHaveLength(1);
});

test("appliance settings share one draft and explain clock and local logger rollback risk", async ({ page }) => {
  const backend = await mockBackend(page); await connect(page);
  await navigate(page, "Appliance NTP");
  await expect(page.getByRole("main").getByRole("heading")).toHaveCount(0);
  await page.getByLabel("Desired enabled", { exact: true }).check();
  await page.getByLabel("NTP server hosts", { exact: true }).fill("clock.example\n::1");
  await page.getByRole("button", { name: "Stage service changes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Discard unstaged input", exact: true })).toBeDisabled();
  await navigate(page, "Appliance syslog");
  await expect(page.getByRole("main")).not.toContainText("Operator prerequisites");
  await page.getByRole("button", { name: "Add syslog destinations", exact: true }).click();
  await page.getByLabel("Syslog host", { exact: true }).fill("logs.example");
  await page.getByLabel("Explicit syslog port", { exact: true }).fill("6514");
  await page.getByLabel("Explicit transport", { exact: true }).press("Enter");
  await page.getByRole("option", { name: "TLS", exact: true }).click();
  await page.getByLabel("Desired enabled", { exact: true }).check();
  await page.getByRole("button", { name: "Stage service changes", exact: true }).click();
  await navigate(page, "vnStat");
  await expect(page.getByRole("main")).not.toContainText("Operator prerequisites");
  await page.getByLabel("Desired enabled", { exact: true }).check();
  await page.getByRole("button", { name: "Stage service changes", exact: true }).click();
  expect(backend.writes).toHaveLength(0);
  await navigate(page, "Review changes");
  await expect(page.getByRole("main")).toContainText("whole appliance clock");
  await expect(page.getByRole("main")).toContainText("stop local system logging");
  await expect(page.getByRole("main")).toContainText("No HTTP historical metrics exist");
  await page.getByRole("button", { name: "Review provisional apply" }).click();
  await expect(page.getByRole("dialog")).toContainText("ntp.write, syslog.write, vnstat.write");
  await page.getByLabel("I reviewed the complete package, deletion impact, disruption risk, deadline, and recovery prerequisites.").check();
  await page.getByRole("button", { name: "Apply provisionally", exact: true }).click();
  await expect(page.getByRole("main")).toContainText("pending_confirmation");
  expect(backend.writes[0]?.body).toMatchObject({ config: {
    ntp: { enabled: true, servers: ["clock.example", "::1"] },
    syslog: { enabled: true, servers: [{ host: "logs.example", port: 6514, transport: "tls" }] },
    vnstat: { enabled: true }, routes: config().routes, gateway_monitors: [],
  } });
  expect(backend.writes).toHaveLength(1);
});

test("gateway fractional metrics, null gaps and stale health remain distinct", async ({ page }) => {
  const initial = config(); initial.gateway_monitors = [monitor()];
  const row = gatewayStatistics(); row.rtt_variation_ms = null;
  row.collected_at = new Date(Date.now() - 10000).toISOString();
  await mockBackend(page, { initialConfig: initial, gatewayRows: [row] });
  await connect(page);
  await navigate(page, "Gateway monitors");
  const panel = page.getByRole("region", { name: "Gateway health statistics" });
  await expect(panel).toContainText("33.333333333333336 %");
  await panel.getByText("Measurements", { exact: true }).click();
  await expect(panel).toContainText("0 ms"); await expect(panel).toContainText("1.25 ms");
  await expect(panel).toContainText("Unavailable"); await expect(panel).toContainText("stale");
  await expect(panel.getByRole("cell", { name: "unknown", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("operational pages keep content compact with readable details", async ({ page }, testInfo) => {
  const backend = await mockBackend(page, { initialStatus: "committed" });
  await connect(page);
  for (const entry of navigationSections.flatMap(section => section.pages).filter(entry => entry.path !== "/overview")) {
    await navigate(page, entry.title);
    const main = page.getByRole("main");
    await expect(page).toHaveURL(new RegExp(`${entry.path}$`));
    await expect(main.getByRole("heading", { level: 1 })).toHaveCount(0);
    await expect(main.locator("pre")).toHaveCount(0);
    await expect(main).not.toContainText("Operator prerequisites");
    await expect(main).not.toContainText("Last successful read");
    await expect(main).not.toContainText("Journal metadata is not a full audit-event log");
    await expect(main.locator(".filter-grid")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (["/services/syslog", "/firewall", "/history", "/changes"].includes(entry.path)) {
      await page.screenshot({ path: testInfo.outputPath(`${entry.name}-compact.png`), fullPage: true, animations: "disabled" });
    }
  }
  await page.getByRole("main").getByRole("link", { name: "0", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Revision 0", exact: true })).toBeVisible();
  await expect(page.locator("details").filter({ has: page.getByText("Configuration", { exact: true }) })).not.toHaveAttribute("open");
  await page.screenshot({ path: testInfo.outputPath("revision-compact.png"), fullPage: true, animations: "disabled" });
  await navigate(page, "Transactions");
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
  await navigate(page, "Appliance NTP");
  await page.getByRole("button", { name: "Reconcile all managed services", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("gateway_monitors.write");
  await expect(page.getByRole("dialog")).toContainText("vnstat.write");
  await page.getByRole("button", { name: "Reconcile all services", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("HTTP 403");
  expect(backend.writes).toEqual([{ path: "/services/ntp/reconcile", body: undefined }]);
});
