import { expect, test, type Page } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { bgpConfig } from "../bgpFixtures";
import { navigationSections } from "../../src/constants/navigation";
import { interfaceSchema, type PackageRequest } from "../../src/types/domain";

async function navigate(page: Page, title: string) {
  const section = navigationSections.find(group => group.pages.some(entry => entry.title === title));
  if (!section) throw new Error(`Unknown page: ${title}`);
  const tabs = page.getByRole("navigation", { name: `${section.title} pages` });
  if (!await tabs.isVisible()) {
    if (section.name === "config-section") await page.getByRole("group", { name: "Firewall status" }).getByRole("link", { name: "Save configuration", exact: true }).click();
    else {
      const hamburger = page.getByRole("button", { name: "Open navigation menu", exact: true });
      if (await hamburger.isVisible() && await hamburger.getAttribute("aria-expanded") !== "true") await hamburger.click();
      await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: section.title, exact: true }).click();
    }
  }
  const expand = tabs.getByRole("button", { name: /^Expand .* navigation$/ });
  if (await expand.isVisible()) await expand.click();
  await tabs.getByRole("tab", { name: title, exact: true }).click();
}
async function select(page: Page, label: string, value: string) {
  await page.locator(".v-select").filter({ has: page.getByRole("combobox", { name: label, exact: true }) }).click();
  await page.getByRole("option", { name: value, exact: true }).click();
}
test("WireGuard BGP next hops accept keyboard input and survive staging", async ({ page }, testInfo) => {
  const initialConfig = bgpConfig(), publicKey = "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=";
  initialConfig.interfaces.push(interfaceSchema.parse({
    name: "wg0", kind: "wireguard", role: "lan", up: true, mtu: 1420, addresses: ["10.0.0.1/24"],
    wireguard: { key_ref: "a".repeat(32), listen_port: 51820, peers: [{ public_key: publicKey, enabled: true, allowed_ips: ["10.0.0.2/32", "198.51.100.0/24"], persistent_keepalive_seconds: 25 }] },
  }));
  Object.assign(initialConfig.bgp!.neighbors[0]!, { interface: "wg0", address: "10.0.0.2", local_address: "10.0.0.1", wireguard_public_key: publicKey });
  const backend = await mockBackend(page, { initialConfig });
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await navigate(page, "BGP PEERS");
  await page.getByRole("button", { name: "Edit BGP peer remote", exact: true }).click();
  const editor = page.getByRole("group", { name: "BGP peer editor", exact: true });
  await expect(editor).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Sent routes", exact: true })).toHaveCount(0);
  expect(await editor.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  const fieldHeights = await editor.locator(".v-text-field:not(.v-textarea) .v-field").evaluateAll(fields => fields.map(field => field.getBoundingClientRect().height));
  expect(Math.max(...fieldHeights) - Math.min(...fieldHeights)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const gateways = page.getByLabel("Allowed next hops", { exact: true });
  await expect(gateways).toBeEnabled();
  await gateways.fill("203.0.113.5");
  await page.getByRole("button", { name: "Save peer", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "203.0.113.5 must be covered" })).toBeVisible();
  await expect(editor).toBeVisible();
  expect(backend.writes).toEqual([]);
  await gateways.fill("");
  await gateways.click();
  await expect(gateways).toBeFocused();
  await gateways.pressSequentially("198.51.100.3");
  await gateways.press("Enter");
  await gateways.pressSequentially("198.51.100.4");
  await expect(gateways).toHaveValue("198.51.100.3\n198.51.100.4");
  await editor.screenshot({ path: testInfo.outputPath("bgp-peer-editor.png"), animations: "disabled" });
  await page.getByRole("button", { name: "Save peer", exact: true }).click();
  await expect(gateways).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Sent routes", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit BGP peer remote", exact: true }).click();
  await expect(gateways).toBeEnabled();
  await expect(gateways).toHaveValue("198.51.100.3\n198.51.100.4");
  expect(backend.writes).toEqual([]);
});

test("BGP peer enable switches stage beside Actions and persist through confirmed apply", async ({ page }) => {
  const initialConfig = bgpConfig(), backend = await mockBackend(page, { initialConfig });
  const dialogs: string[] = [];
  page.on("dialog", async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await navigate(page, "BGP PEERS");
  const peers = page.getByRole("region", { name: "BGP peers", exact: true });
  const toggle = peers.getByRole("checkbox", { name: "BGP peer enabled for remote", exact: true });
  await expect(toggle).toBeChecked();
  await expect(peers.locator("thead th").nth(9)).toHaveText("Enabled");
  await expect(peers.locator("thead th").nth(10)).toHaveText("Actions");
  await expect(peers.locator("tbody tr").first().getByRole("cell").nth(9).getByRole("checkbox")).toBeChecked();
  for (const enabled of [false, true]) {
    const writesBefore = backend.writes.length;
    await toggle.setChecked(enabled);
    await expect(peers).toContainText("Not applied");
    expect(backend.writes).toHaveLength(writesBefore);
    expect(dialogs).toEqual([]);
    await navigate(page, "SAVE");
    const review = page.getByRole("region", { name: "SAVE", exact: true });
    await expect(review.locator(".diff-warnings")).toContainText("restart the whole BGP worker");
    await review.getByRole("button", { name: "Commit & push", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("bgp.write");
    await dialog.getByRole("button", { name: "Push changes", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Confirm changes", exact: true })).toBeEnabled();
    await dialog.getByRole("button", { name: "Confirm changes", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    const submitted = backend.writes.filter(write => write.path === "/transactions").at(-1)!.body as PackageRequest;
    expect(submitted.config.bgp!.neighbors[0]).toEqual({ ...initialConfig.bgp!.neighbors[0], enabled });
    expect(submitted.config.bgp!.enabled).toBe(true);
    expect(submitted.config.interfaces).toEqual(initialConfig.interfaces);
    expect(submitted.config.routes).toEqual(initialConfig.routes);
    await navigate(page, "SAVE");
    await expect(review).toContainText("No unsaved changes.");
    await page.reload(); await navigate(page, "BGP PEERS");
    await expect(toggle).toBeChecked({ checked: enabled });
    await expect(peers.locator(".v-chip")).toHaveText(enabled ? "Established" : "Disabled");
    await expect(peers.locator(".v-chip")).not.toHaveClass(/text-error/);
    await navigate(page, "BGP ROUTES");
    await expect(page.getByRole("cell", { name: "198.51.100.0/24", exact: true })).toHaveCount(enabled ? 1 : 0);
    await navigate(page, "BGP PEERS");
  }
});

test("BGP overview distributes peer details across the full card width", async ({ page, isMobile }, testInfo) => {
  await mockBackend(page, { initialConfig: bgpConfig() });
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.goto("/diagnostics/system-overview");
  const widget = page.getByRole("region", { name: "BGP peers", exact: true });
  await expect(widget).toContainText("Established");
  const sizes = isMobile ? [page.viewportSize()!] : [{ width: 1280, height: 900 }, { width: 1920, height: 1080 }];
  for (const size of sizes) {
    await page.setViewportSize(size);
    const table = widget.getByRole("table");
    const headers = table.getByRole("columnheader");
    const cells = table.locator("tbody tr").first().getByRole("cell");
    for (const [index, alignment] of [/^(left|start)$/, "center", "right"].entries()) {
      await expect(headers.nth(index)).toHaveCSS("text-align", alignment);
      await expect(cells.nth(index)).toHaveCSS("text-align", alignment);
    }
    const widths = await headers.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().width));
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
    const bounds = (await table.boundingBox())!, card = (await widget.boundingBox())!;
    expect(Math.abs(bounds.width - (card.width - 2))).toBeLessThanOrEqual(1);
    expect(await widget.locator(".v-table__wrapper").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await widget.screenshot({ path: testInfo.outputPath("bgp-overview-full-width.png"), animations: "disabled" });
});

test("BGP peers and DNAT stage inline, preserve the complete package, and survive confirmation", async ({ page }, testInfo) => {
  const initialConfig = bgpConfig(), backend = await mockBackend(page, { initialConfig });
  const dialogs: string[] = [];
  page.on("dialog", async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("region", { name: "Overview", exact: true })).toBeVisible();
  await navigate(page, "SYSTEM OVERVIEW");
  const overview = page.getByRole("region", { name: "System overview", exact: true });
  await expect(overview).toBeVisible();
  await expect(overview.getByRole("region", { name: "BGP peers", exact: true })).toContainText("Established");
  await navigate(page, "BGP PROCESS");
  const process = page.getByRole("region", { name: "BGP process", exact: true });
  await expect(process.getByRole("checkbox", { name: "BGP enabled" })).toBeChecked();
  await expect(process.locator(".v-switch__track")).toHaveClass(/bg-primary/);
  await expect(process.getByLabel("Keepalive (seconds)", { exact: true })).toBeVisible();
  await expect(process.getByRole("button", { name: "Add BGP peer", exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("bgp-process.png"), fullPage: true, animations: "disabled" });
  await navigate(page, "BGP ROUTES");
  const routes = page.getByRole("region", { name: "BGP routes", exact: true });
  await expect(routes.getByRole("cell", { name: "198.51.100.0/24", exact: true })).toBeVisible();
  await expect(routes.getByRole("columnheader", { name: "Reason", exact: true })).toHaveCount(0);
  await routes.getByRole("tab", { name: "Advertised", exact: true }).click();
  await expect(routes.getByRole("table")).toHaveAccessibleName("Advertised BGP routes");
  await expect(routes.getByRole("cell", { name: /203\.0\.113\.0\/24/ })).toHaveCount(2);
  await expect(routes.locator("thead th")).toHaveText(["Prefix", "Peer", "Interface", "Next hop"]);
  await expect(routes).not.toContainText("connected_or_static_route");
  await select(page, "Neighbor", "second");
  await expect(routes.getByRole("cell", { name: /203\.0\.113\.0\/24/ })).toHaveCount(1);
  await expect(routes.getByRole("cell", { name: /second$/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("bgp-advertised-routes.png"), fullPage: true, animations: "disabled" });
  await routes.getByRole("tab", { name: "Received", exact: true }).click();
  await expect(routes.getByRole("cell", { name: "198.51.100.0/24", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("bgp-routes.png"), fullPage: true, animations: "disabled" });
  await navigate(page, "BGP PEERS");
  const bgp = page.getByRole("region", { name: "BGP peers", exact: true });
  await expect(bgp.locator(".v-chip").filter({ hasText: "Established" })).toHaveClass(/text-success/);
  await expect(bgp.getByRole("row").filter({ hasText: "Established" }).getByRole("cell").nth(6)).toHaveText("2");
  await expect(bgp.getByRole("row").filter({ hasText: "Established" }).getByRole("cell").nth(7)).toHaveText("1");
  await expect(bgp.getByLabel("Local ASN", { exact: true })).toHaveCount(0);
  await bgp.getByRole("button", { name: "Add BGP peer", exact: true }).click();
  await bgp.getByLabel("Peer name", { exact: true }).fill("second");
  await bgp.getByLabel("Peer address", { exact: true }).fill("198.51.100.22");
  await select(page, "Peer interface", "LAB0");
  await select(page, "Local address", "192.0.2.10");
  await bgp.getByLabel("Multihop TTL", { exact: true }).fill("8");
  await bgp.getByLabel("Allowed next hops", { exact: true }).fill("192.0.2.1,\n192.0.2.3");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await bgp.getByRole("button", { name: "Save peer", exact: true }).click();
  await expect(bgp).toContainText("second");
  await expect(bgp).toContainText("Not applied");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("bgp-peers.png"), fullPage: true, animations: "disabled" });
  await navigate(page, "DNAT");
  const dnat = page.getByRole("region", { name: "DNAT", exact: true });
  await dnat.getByRole("button", { name: "Add DNAT rule", exact: true }).click();
  await select(page, "WAN", "WAN0"); await select(page, "Protocol", "udp"); await select(page, "Target interface", "LAB0");
  await dnat.getByLabel("Target address", { exact: true }).fill("192.0.2.53");
  await dnat.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dnat).toContainText("192.0.2.53");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("dnat.png"), fullPage: true, animations: "disabled" });
  expect(backend.writes).toEqual([]); expect(dialogs).toEqual([]);
  await navigate(page, "SAVE");
  const review = page.getByRole("region", { name: "SAVE", exact: true });
  await expect(review).not.toContainText("same-subnet direct replies");
  await review.getByRole("button", { name: "Commit & push", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("bgp.write"); await expect(dialog).toContainText("nat.write");
  await dialog.getByRole("button", { name: "Push changes", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Confirm changes", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Confirm changes", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const submitted = backend.writes.find(write => write.path === "/transactions")!.body as PackageRequest;
  expect(submitted.config.bgp!.neighbors).toHaveLength(2);
  expect(submitted.config.bgp!.neighbors.find(peer => peer.name === "second")).toMatchObject({
    address: "198.51.100.22", local_address: "192.0.2.10", multihop_ttl: 8, allowed_next_hops: ["192.0.2.1", "192.0.2.3"],
  });
  expect(submitted.config.firewall.nat.destination_rewrite).toEqual([{ origin: "manual", import_source: null, out_interface: "wan0", protocol: "udp", destination_port: 53, target_interface: "lab0", target_address: "192.0.2.53" }]);
  expect(submitted.config.firewall.nat.masquerade).toEqual(initialConfig.firewall.nat.masquerade);
  expect(submitted.config.routes).toEqual(initialConfig.routes);
  expect(submitted.config.interfaces).toEqual(initialConfig.interfaces);
  await page.reload(); await navigate(page, "BGP PEERS");
  await expect(page.getByRole("region", { name: "BGP peers", exact: true })).toContainText("second");
  await page.getByRole("button", { name: "Edit BGP peer second", exact: true }).click();
  await expect(page.getByLabel("Multihop TTL", { exact: true })).toHaveValue("8");
  await expect(page.getByLabel("Allowed next hops", { exact: true })).toHaveValue("192.0.2.1\n192.0.2.3");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await navigate(page, "DNAT");
  await expect(page.getByRole("region", { name: "DNAT", exact: true })).toContainText("192.0.2.53");
});
