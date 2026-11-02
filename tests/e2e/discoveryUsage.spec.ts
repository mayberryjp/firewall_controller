import { expect, test } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { config, mdnsStatus, udpRelayStatus } from "../fixtures";
import { mdnsSchema } from "../../src/types/domain";

test("discovery entry usage remains exact and supports removing unobserved entries on desktop and mobile", async ({ page }) => {
  const initial = config();
  initial.interfaces = ["lan0", "lan1"].map(name => ({
    name, kind: "ethernet", role: "lan", up: true, mtu: 1500,
    addresses: ["192.168.1.1/24"], dhcp_relay: { enabled: false, servers: [] },
  }));
  initial.routes = []; initial.softflowd = []; initial.firewall.nat.masquerade = [];
  initial.system = { hostname: "firewall", domain: "", timezone: "America/Los_Angeles" };
  initial.mdns = mdnsSchema.parse({
    enabled: true, ipv6: false, interfaces: ["lan0", "lan1"],
    reflection: { enabled: true, filters: ["_ipp._tcp.local.", "_http._tcp.local."] },
  });
  const relay = { ...udpRelayStatus(), interfaces: ["lan0", "lan1"] };
  initial.udp_broadcast_relay = {
    enabled: true, instances: [1, 2].map(id => ({
      id, enabled: true, port: id === 1 ? 4001 : 3610, interfaces: relay.interfaces,
      multicast_address: relay.multicast_address, source: relay.source,
    })),
  };
  const backend = await mockBackend(page, { initialConfig: initial });
  const sample = { ...mdnsStatus(), statistics_complete: true, filter_counters: [
    { filter: "_http._tcp.local.", matched_packets: "0", transmitted_packets: "0", last_used_at: null, last_transmitted_at: null },
    { filter: "_ipp._tcp.local.", matched_packets: "9007199254740993", transmitted_packets: "18446744073709551615", last_used_at: "2026-01-02T03:04:05.987+02:00", last_transmitted_at: null },
  ] };
  await page.route("**/proxy/services/mdns/status", route => route.fulfill({ json: { instances: [sample], error: "" } }));
  await page.route("**/proxy/services/udp-broadcast-relay/status", route => route.fulfill({ json: { instances: [
    { ...relay, instance_id: 2, port: 3610, received_packets: "0", transmitted_packets: "0" }, relay,
  ], error: "" } }));
  const dialogs: string[] = [];
  page.on("dialog", async dialog => { dialogs.push(dialog.type()); await dialog.dismiss(); });
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("region", { name: "Overview", exact: true })).toBeVisible();

  await page.goto("/services/mdns");
  const mdns = page.getByRole("region", { name: "mDNS / Discovery", exact: true });
  await expect(mdns.getByLabel("Usage for service 1", { exact: true })).toContainText("Matched: 9007199254740993");
  await expect(mdns.getByLabel("Usage for service 1", { exact: true })).toContainText("Forwarded: 18446744073709551615");
  await expect(mdns.getByLabel("Usage for service 1", { exact: true })).toContainText("Last used (America/Los_Angeles): 2026-01-01 17:04:05");
  await expect(mdns.getByLabel("Usage for service 2", { exact: true })).toContainText("Matched: 0");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mdns.getByRole("button", { name: "Delete service 2", exact: true }).click();
  await mdns.getByRole("button", { name: "Stage changes", exact: true }).click();
  await expect(mdns.getByLabel("Service 2", { exact: true })).toHaveCount(0);

  await page.getByRole("tab", { name: "UDP BROADCAST RELAY", exact: true }).click();
  const udp = page.getByRole("region", { name: "UDP Broadcast Relay", exact: true });
  await expect(udp.getByLabel("Usage for relay 1", { exact: true })).toContainText("Received: 9007199254740993");
  await expect(udp.getByLabel("Usage for relay 1", { exact: true })).toContainText("Forwarded: 18446744073709551615");
  await expect(udp.getByLabel("Usage for relay 2", { exact: true })).toContainText("Received: 0");
  await expect(udp).not.toContainText("Last used");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await udp.getByRole("button", { name: "Delete relay 2", exact: true }).click();
  await expect(udp.getByRole("button", { name: "Delete relay 2", exact: true })).toHaveCount(0);
  expect(backend.writes).toEqual([]); expect(dialogs).toEqual([]);
});
