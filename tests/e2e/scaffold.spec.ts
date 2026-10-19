import { expect, test, type Page } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { config, gatewayStatistics, monitor } from "../fixtures";

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
test("invalid device credentials do not start a polling loop or persist tokens", async ({ page }) => {
  await mockBackend(page, { invalidCredential: true });
  const requests: string[] = [];
  page.on("request", request => { if (new URL(request.url()).port === "8080") requests.push(request.url()); });
  await page.goto("/connect");
  await signInToRegistry(page);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "401" }).first()).toBeVisible();
  await page.waitForTimeout(1500);
  expect(requests).toHaveLength(1);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

test("recovery remains accessible when state observation is unavailable", async ({ page }) => {
  await mockBackend(page, { observationFailed: true, initialStatus: "recovery_failed" });
  await connect(page);
  await expect(page.getByText("Critical: recovery failed", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry rollback", exact: true })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Observation unavailable");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("shared route draft preserves other subsystems and requires explicit apply and confirmation", async ({ page, isMobile }) => {
  const backend = await mockBackend(page);
  await connect(page);
  if (isMobile) await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page.getByRole("link", { name: "Routes", exact: true }).click();
  await page.getByRole("button", { name: "Edit / stage", exact: true }).click();
  await page.getByLabel("Metric", { exact: true }).fill("42");
  await page.getByRole("button", { name: "Stage changes", exact: true }).click();
  expect(backend.writes).toHaveLength(0);
  await page.getByRole("main").getByRole("link", { name: "Review changes", exact: true }).click();
  await page.getByRole("button", { name: "Review provisional apply" }).click();
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
  await expect(page.getByRole("main")).toContainText("Committed revision 1");
  expect(backend.writes.filter(write => write.path.endsWith("/confirm"))).toHaveLength(1);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

test("unknown write outcomes are frozen and never automatically replayed", async ({ page, isMobile }) => {
  const backend = await mockBackend(page, { lostSubmit: true });
  await connect(page);
  if (isMobile) await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page.getByRole("link", { name: "Routes", exact: true }).click();
  await page.getByRole("button", { name: "Edit / stage", exact: true }).click();
  await page.getByLabel("Metric", { exact: true }).fill("99");
  await page.getByRole("button", { name: "Stage changes", exact: true }).click();
  await page.getByRole("main").getByRole("link", { name: "Review changes", exact: true }).click();
  await page.getByRole("button", { name: "Review provisional apply" }).click();
  await page.getByLabel("I reviewed the complete package, deletion impact, disruption risk, deadline, and recovery prerequisites.").check();
  await page.getByRole("button", { name: "Apply provisionally", exact: true }).click();
  await expect(page.getByText("Outcome unknown: Apply package.", { exact: true })).toBeVisible();
  await page.waitForTimeout(1500);
  expect(backend.writes.filter(write => write.path === "/transactions")).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("reload requires credential re-entry and rediscovers pending transactions", async ({ page }) => {
  await mockBackend(page, { initialStatus: "pending_confirmation" }); await connect(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Connect to a firewall" })).toBeVisible();
  await signInToRegistry(page);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("main")).toContainText("pending confirmation");
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

test("ICMP false is staged explicitly and preserved with host/interface policy mode", async ({ page, isMobile }) => {
  const initial = config(); initial.firewall.rules = []; initial.firewall.policies = { hosts: [], interfaces: [] };
  const backend = await mockBackend(page, { initialConfig: initial });
  await connect(page);
  if (isMobile) await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page.getByRole("link", { name: "Firewall forwarding", exact: true }).click();
  await expect(page.getByRole("main")).toContainText("Host/interface policy mode is active");
  await page.getByLabel("Draft allow all IPv4 ICMP", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Stage ICMP change", exact: true }).click();
  expect(backend.writes).toHaveLength(0);
  await page.getByRole("main").getByRole("link", { name: "Review changes", exact: true }).click();
  await expect(page.getByRole("main")).toContainText("Allow all IPv4 ICMP");
  await page.getByRole("button", { name: "Review provisional apply" }).click();
  await page.getByLabel("I reviewed the complete package, deletion impact, disruption risk, deadline, and recovery prerequisites.").check();
  await page.getByRole("button", { name: "Apply provisionally", exact: true }).click();
  await expect(page.getByRole("main")).toContainText("pending_confirmation");
  expect(backend.writes[0]?.body).toMatchObject({ config: { firewall: { allow_all_icmp: false, policies: { hosts: [], interfaces: [] } } } });
  expect(backend.writes).toHaveLength(1);
});

test("WAN role and multi-server relay stage together without auto-configuring networking", async ({ page, isMobile }) => {
  const backend = await mockBackend(page); await connect(page);
  if (isMobile) await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page.getByRole("link", { name: "Interfaces", exact: true }).click();
  await page.getByRole("button", { name: "Edit / stage", exact: true }).click();
  await page.getByLabel("Required interface role", { exact: true }).press("Enter");
  await page.getByRole("option", { name: "WAN", exact: true }).click();
  await page.getByLabel("Enable DHCPv4 relay", { exact: true }).check();
  await page.getByLabel("DHCPv4 relay servers", { exact: true }).fill("198.51.100.10\n198.51.100.20");
  await expect(page.getByRole("dialog")).toContainText("Selected DHCP relay address/subnet: 192.0.2.10/24");
  await page.getByRole("button", { name: "Stage changes", exact: true }).click();
  expect(backend.writes).toHaveLength(0);
  await page.getByRole("main").getByRole("link", { name: "Review changes", exact: true }).click();
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

test("relay repair is explicit, bodyless and keeps forbidden errors visible", async ({ page, isMobile }) => {
  const initial = config(); initial.interfaces[0]!.dhcp_relay = { enabled: true, servers: ["198.51.100.10"] };
  initial.softflowd[0]!.enabled = true;
  const backend = await mockBackend(page, { initialConfig: initial, serviceDenied: true }); await connect(page);
  if (isMobile) await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page.getByRole("link", { name: "DHCPv4 relay", exact: true }).click();
  await expect(page.getByRole("main")).toContainText("Simulated; no real relay activity");
  expect(backend.writes).toHaveLength(0);
  await page.getByRole("button", { name: "Reconcile all managed services", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("softflowd.write");
  await page.getByRole("button", { name: "Reconcile all services", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("HTTP 403: interfaces.write permission required");
  expect(backend.writes).toEqual([{ path: "/services/dhcp-relay/reconcile", body: undefined }]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

async function navigate(page: Page, mobile: boolean, label: string): Promise<void> {
  if (mobile) await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page.getByRole("navigation").getByRole("link", { name: label, exact: true }).click();
}

test("gateway create stages an explicit path and preserves complete package state", async ({ page, isMobile }) => {
  const backend = await mockBackend(page); await connect(page);
  await navigate(page, isMobile, "Gateway monitors");
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
  await navigate(page, isMobile, "Review changes");
  await expect(page.getByRole("main")).toContainText("gateway_monitors.write");
  await page.getByRole("button", { name: "Review provisional apply" }).click();
  await page.getByLabel("I reviewed the complete package, deletion impact, disruption risk, deadline, and recovery prerequisites.").check();
  await page.getByRole("button", { name: "Apply provisionally", exact: true }).click();
  await expect(page.getByRole("main")).toContainText("pending_confirmation");
  expect(backend.writes[0]?.body).toMatchObject({ config: { gateway_monitors: [monitor()], ntp: config().ntp, syslog: config().syslog, vnstat: config().vnstat, interfaces: config().interfaces } });
  expect(backend.writes).toHaveLength(1);
});

test("appliance settings share one draft and explain clock and local logger rollback risk", async ({ page, isMobile }) => {
  const backend = await mockBackend(page); await connect(page);
  await navigate(page, isMobile, "Appliance NTP");
  await expect(page.getByRole("main")).toContainText("whole appliance clock");
  await page.getByLabel("Desired enabled", { exact: true }).check();
  await page.getByLabel("NTP server hosts", { exact: true }).fill("clock.example\n::1");
  await page.getByRole("button", { name: "Stage service changes", exact: true }).click();
  await navigate(page, isMobile, "Appliance syslog");
  await expect(page.getByRole("main")).toContainText("stop local system logging");
  await page.getByRole("button", { name: "Add syslog destinations", exact: true }).click();
  await page.getByLabel("Syslog host", { exact: true }).fill("logs.example");
  await page.getByLabel("Explicit syslog port", { exact: true }).fill("6514");
  await page.getByLabel("Explicit transport", { exact: true }).press("Enter");
  await page.getByRole("option", { name: "TLS", exact: true }).click();
  await page.getByLabel("Desired enabled", { exact: true }).check();
  await page.getByRole("button", { name: "Stage service changes", exact: true }).click();
  await navigate(page, isMobile, "vnStat");
  await expect(page.getByRole("main")).toContainText("No HTTP historical metrics exist");
  await page.getByLabel("Desired enabled", { exact: true }).check();
  await page.getByRole("button", { name: "Stage service changes", exact: true }).click();
  expect(backend.writes).toHaveLength(0);
  await navigate(page, isMobile, "Review changes");
  await expect(page.getByRole("main")).toContainText("ntp.write, syslog.write, vnstat.write");
  await page.getByRole("button", { name: "Review provisional apply" }).click();
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
  const panel = page.getByRole("region", { name: "Gateway health statistics" });
  await expect(panel).toContainText("33.333333333333336 %");
  await expect(panel).toContainText("0 ms"); await expect(panel).toContainText("1.25 ms");
  await expect(panel).toContainText("Unavailable"); await expect(panel).toContainText("stale");
  await expect(panel.getByRole("cell", { name: "unknown", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("appliance repair uses stored cross-service permissions and keeps 403 visible", async ({ page, isMobile }) => {
  const initial = config(); initial.gateway_monitors = [monitor()]; initial.ntp = { enabled: true, servers: ["clock.example"] }; initial.vnstat.enabled = true;
  const backend = await mockBackend(page, { initialConfig: initial, serviceDenied: true }); await connect(page);
  await navigate(page, isMobile, "Appliance NTP");
  await page.getByRole("button", { name: "Reconcile all managed services", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("gateway_monitors.write");
  await expect(page.getByRole("dialog")).toContainText("vnstat.write");
  await page.getByRole("button", { name: "Reconcile all services", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("HTTP 403");
  expect(backend.writes).toEqual([{ path: "/services/ntp/reconcile", body: undefined }]);
});
