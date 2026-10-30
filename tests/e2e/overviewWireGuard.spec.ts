import { expect, test } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { config, runtime } from "../fixtures";
import { bgpConfig, bgpRoutes } from "../bgpFixtures";

test("overview lists WireGuard peer endpoints and metrics without overflowing or changing configuration", async ({ page }, testInfo) => {
  const initialConfig = config();
  const publicKey = "A".repeat(43) + "=";
  initialConfig.interfaces.push({
    name: "wg0", kind: "wireguard", role: "wan", mtu: 1420, up: true, addresses: [],
    dhcp_relay: { enabled: false, servers: [] },
    wireguard: { key_ref: "wg-key", listen_port: 51820, peers: [
      { public_key: publicKey, endpoint: "192.0.2.1:51820", allowed_ips: ["10.0.0.0/24"], persistent_keepalive_seconds: 25 },
      { public_key: "C".repeat(43) + "=", allowed_ips: ["10.2.0.0/24"], persistent_keepalive_seconds: 0 },
      { public_key: "B".repeat(43) + "=", allowed_ips: ["10.1.0.0/24"], persistent_keepalive_seconds: 0, enabled: false },
    ] },
  });
  const backend = await mockBackend(page, { initialConfig });
  await page.route("**/proxy/runtime", route => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ ...runtime(), wireguard: [
      { interface: "wg0", public_key: null, listen_port: 51820, peers: [
        { public_key: publicKey, endpoint: "192.0.2.1:51820", last_handshake_unix_seconds: Math.floor(Date.now() / 1000) - 25, rx_bytes: "1234567", tx_bytes: "2048" },
        { public_key: "C".repeat(43) + "=", endpoint: "[2001:db8::1]:51820", last_handshake_unix_seconds: 0, rx_bytes: "3000", tx_bytes: "4000" },
      ] },
    ] }),
  }));
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const widget = page.getByRole("region", { name: "WireGuard", exact: true });
  await expect(widget).toBeVisible();
  await expect(widget.getByRole("columnheader")).toHaveText(["Peer", "Last handshake", "Received", "Sent"]);
  await expect(widget.locator("tbody tr")).toHaveCount(2);
  await expect(widget.locator("tbody tr").nth(0).locator("td")).toHaveText(["192.0.2.1:51820", /ago$/, "1.23 MB", "2.05 KB"]);
  await expect(widget.locator("tbody tr").nth(1).locator("td")).toHaveText(["[2001:db8::1]:51820", "NEVER", "3 KB", "4 KB"]);
  await expect(widget).toContainText("1.23 MB");
  await expect(widget).toContainText("2.05 KB");
  await expect(widget.locator(".v-chip").first()).toHaveClass(/text-green/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await widget.screenshot({ path: testInfo.outputPath("overview-wireguard.png"), animations: "disabled" });
  await widget.getByRole("link", { name: "Open WireGuard" }).click();
  await expect(page.getByRole("region", { name: "WireGuard peers", exact: true })).toContainText("1.23 MB");
  expect(backend.writes).toHaveLength(0);
});

test("WireGuard details display installed BGP additions read-only and remove withdrawn networks", async ({ page }) => {
  const initialConfig = bgpConfig(), publicKey = btoa("\x01".repeat(32)), routes = bgpRoutes();
  initialConfig.interfaces.push({
    name: "wg0", kind: "wireguard", role: "wan", mtu: 1420, up: true, addresses: ["10.20.0.1/24"],
    dhcp_relay: { enabled: false, servers: [] },
    wireguard: { key_ref: "wg-key", listen_port: 51820, peers: [{
      public_key: publicKey, allowed_ips: ["10.20.0.0/24"], persistent_keepalive_seconds: 25,
    }] },
  });
  Object.assign(initialConfig.bgp!.neighbors[0]!, {
    interface: "wg0", wireguard_public_key: publicKey, local_address: "10.20.0.1", address: "10.20.0.2",
  });
  const learned = { ...routes.routes[0]!, prefix: "198.51.101.0/24", interface: "wg0", installed: true, reason: null };
  routes.routes = [learned, { ...learned, prefix: "203.0.113.0/24", installed: false, reason: "wireguard_static_peer_overlap" }];
  const backend = await mockBackend(page, { initialConfig });
  let reads = 0;
  await page.route("**/proxy/routes/bgp", route => {
    reads++;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(routes) });
  });
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL(/\/overview$/);
  await page.goto("/wireguard");
  await page.getByRole("button", { name: /^Details for wg0 peer/ }).click();
  const details = page.locator(".peer-details");
  await expect(details.locator(".configured-networks")).toHaveText("10.20.0.0/24 (Configured)");
  await expect(details.locator(".learned-network")).toHaveText("198.51.101.0/24 BGP learned from remote (read-only)");
  await expect(details).not.toContainText("203.0.113.0/24");
  await expect(details.locator(".learned-network").locator("input, textarea, button")).toHaveCount(0);
  await page.getByRole("button", { name: /^Edit peer/ }).click();
  await expect(page.getByLabel("Allowed networks (comma separated)")).toHaveValue("10.20.0.0/24");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  routes.routes = [];
  await expect(details.locator(".learned-network")).toHaveCount(0, { timeout: 10000 });
  expect(reads).toBeGreaterThanOrEqual(2);
  expect(backend.writes).toHaveLength(0);
});
