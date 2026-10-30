import { expect, test } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { config, runtime, wireguardDns } from "../fixtures";
import { configSchema } from "../../src/types/domain";
import { record } from "../../src/types/forms";

for (const editor of ["peer", "tunnel"] as const) {
  test(`WireGuard DNS names survive ${editor} editing and confirmed SAVE without replacing them with runtime IPs`, async ({ page }) => {
    const initial = config(), dns = wireguardDns(), sample = dns.peers[0]!;
    initial.interfaces.push({
      name: "wg0", kind: "wireguard", role: "wan", mtu: 1420, up: true, addresses: [],
      dhcp_relay: { enabled: false, servers: [] },
      wireguard: { key_ref: "wg-key", listen_port: 51820, peers: [{
        public_key: sample.public_key, endpoint: sample.endpoint, enabled: true,
        allowed_ips: ["10.40.0.0/24"], persistent_keepalive_seconds: 25,
        metadata: { display_name: "", description: "Preserved peer notes" },
      }] },
    });
    dns.error = "DNS worker stopped"; sample.error = "Resolver timed out";
    const backend = await mockBackend(page, { initialConfig: initial, stateRuntime: editor === "peer" ? { wireguard_dns: dns } : undefined });
    if (editor === "peer") await page.route("**/proxy/runtime", route => route.fulfill({
      contentType: "application/json", body: JSON.stringify({ ...runtime(), wireguard: [{
        interface: "wg0", public_key: null, listen_port: 51820, peers: [{
          public_key: sample.public_key, endpoint: "198.51.100.40:51820",
          last_handshake_unix_seconds: 0, rx_bytes: "10", tx_bytes: "20",
        }],
      }] }),
    }));
    await page.goto("/connect");
    await page.getByLabel("Registry admin password").fill("registry-test-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.getByRole("region", { name: "Overview", exact: true })).toBeVisible();
    await page.goto("/wireguard");
    const view = page.getByRole("region", { name: "WireGuard peers", exact: true });
    await expect(view).toContainText(sample.endpoint);
    await page.getByRole("button", { name: /^Details for wg0 peer/ }).click();
    const details = page.locator(".peer-details");
    if (editor === "peer") {
      await expect(view).toContainText("DNS refresh: DNS worker stopped");
      await expect(view).toContainText("DNS: Resolver timed out");
      await expect(details).toContainText("192.0.2.20:51820");
      await expect(details).toContainText("198.51.100.40:51820");
      await expect(details).toContainText("DNS last success (UTC)");
      await expect(details).toContainText("2026-10-30 19:53:27");
      await expect(details).not.toContainText(".987");
      await expect(view).toContainText("NEVER");
      dns.error = null; sample.error = null; sample.resolved_endpoint = "192.0.2.21:51820";
      await page.reload();
      await page.getByRole("button", { name: /^Details for wg0 peer/ }).click();
      await expect(details).toContainText("192.0.2.21:51820");
      await expect(view).not.toContainText("DNS worker stopped");
      await expect(view).not.toContainText("Resolver timed out");
      await page.getByRole("button", { name: /^Edit peer/ }).click();
      await page.getByLabel("Endpoint (optional, hostname or IP:port)", { exact: true }).fill("vpn2.example.test:51820");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByRole("form", { name: "Edit peer", exact: true })).toHaveCount(0);
      await expect(view).toContainText("vpn2.example.test:51820");
      await expect(details).not.toContainText("192.0.2.21:51820");
      await expect(details).toContainText("Unavailable");
    } else {
      await expect(details).toContainText("Unavailable");
      await expect(view).not.toContainText("DNS worker stopped");
      await page.goto("/tunnels");
      await page.getByRole("button", { name: "Edit wg0", exact: true }).click();
      await page.getByLabel("Listen port", { exact: true }).fill("51821");
      await page.getByRole("button", { name: "Save", exact: true }).click();
    }
    expect(backend.writes).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("link", { name: "Save configuration", exact: true }).click();
    await page.getByRole("button", { name: "Commit & push", exact: true }).click();
    await page.getByRole("button", { name: "Push changes", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Confirm changes", exact: true })).toBeEnabled();
    const submitted = configSchema.parse(record(backend.writes[0]!.body).config);
    const tunnel = submitted.interfaces.find(link => link.name === "wg0");
    expect(tunnel).toMatchObject({ wireguard: {
      key_ref: "wg-key", listen_port: editor === "peer" ? 51820 : 51821, peers: [{
        public_key: sample.public_key, endpoint: editor === "peer" ? "vpn2.example.test:51820" : sample.endpoint,
        enabled: true, allowed_ips: ["10.40.0.0/24"], persistent_keepalive_seconds: 25,
        metadata: { display_name: "", description: "Preserved peer notes" },
      }],
    } });
    expect(submitted).not.toHaveProperty("runtime");
    await page.getByRole("dialog").getByRole("button", { name: "Confirm changes", exact: true }).click();
    await expect(page.getByRole("region", { name: "Commit detail", exact: true })).toContainText("committed");
    await page.goto("/wireguard");
    await expect(view).toContainText(editor === "peer" ? "vpn2.example.test:51820" : sample.endpoint);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
