import { expect, test } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { config, udpRelayStatus } from "../fixtures";
import type { PackageRequest } from "../../src/types/domain";

test("UDP Broadcast Relay stages presets and confirms a complete package on desktop and mobile", async ({ page }, testInfo) => {
  const initial = config();
  initial.interfaces.push(...["lan0", "iot0"].map((name, index) => ({
    name, kind: "ethernet" as const, role: "lan" as const, up: true, mtu: 1500,
    addresses: [`192.168.${index + 10}.1/24`], dhcp_relay: { enabled: false, servers: [] },
  })));
  initial.udp_broadcast_relay = { enabled: false, instances: [], metadata: { display_name: "Discovery", description: "Preserve root metadata" } };
  const backend = await mockBackend(page, { initialConfig: initial });
  const dialogs: string[] = [];
  page.on("dialog", async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("region", { name: "Overview", exact: true })).toBeVisible();
  await page.goto("/services/udp-broadcast-relay");
  const view = page.getByRole("region", { name: "UDP Broadcast Relay", exact: true });
  await expect(view).toBeVisible();
  await expect(page.getByRole("tab", { name: "UDP BROADCAST RELAY", exact: true })).toBeVisible();
  await expect(view.locator("thead th")).toHaveText(["Instance", "Enabled", "UDP port", "Interfaces", "Multicast Address", "Actions"]);
  await expect(view.getByRole("button", { name: "Edit service metadata", exact: true })).toHaveCount(0);
  await expect(view.getByRole("checkbox", { name: "UDP Broadcast Relay enabled", exact: true })).toHaveCount(0);
  await view.getByRole("button", { name: "Presets", exact: true }).click();
  await page.getByText("Govee", { exact: true }).click();
  await expect(view.getByLabel("Instance ID", { exact: true })).toHaveValue("1");
  await expect(view.getByLabel("UDP port", { exact: true })).toHaveValue("4001");
  await expect(view.getByLabel("Source mode", { exact: true })).toHaveCount(0);
  await expect(view.getByRole("checkbox", { name: "Instance enabled", exact: true })).toHaveCount(0);
  const interfaces = view.locator(".v-select").filter({ has: page.getByRole("combobox", { name: "Interfaces", exact: true }) });
  await interfaces.locator(".v-field").click();
  await expect(page.getByRole("option", { name: "lab0", exact: true })).toHaveCount(0);
  await page.getByRole("option", { name: "lan0", exact: true }).click();
  await page.getByRole("option", { name: "iot0", exact: true }).click();
  await page.keyboard.press("Escape");
  await view.getByRole("button", { name: "Stage changes", exact: true }).click();
  await expect(view.getByRole("button", { name: "Edit relay 1", exact: true })).toBeEnabled();
  await expect(view.getByRole("checkbox", { name: "Enable relay 1", exact: true })).not.toBeChecked();
  await view.getByRole("checkbox", { name: "Enable relay 1", exact: true }).check();
  await view.getByRole("checkbox", { name: "Enable relay 1", exact: true }).uncheck();
  await expect(view.getByRole("alert")).toHaveCount(0);
  await view.getByRole("checkbox", { name: "Enable relay 1", exact: true }).check();
  await view.getByRole("button", { name: "Edit relay 1", exact: true }).click();
  await expect(view.getByRole("checkbox", { name: "Instance enabled", exact: true })).toHaveCount(0);
  await view.getByRole("button", { name: "Stage changes", exact: true }).click();
  await expect(view.getByRole("checkbox", { name: "Enable relay 1", exact: true })).toBeChecked();
  expect(backend.writes).toEqual([]);
  expect(dialogs).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("relay-instances.png"), fullPage: true, animations: "disabled" });

  await page.getByRole("link", { name: "Save configuration", exact: true }).click();
  await page.getByText("Operational warnings", { exact: true }).click();
  await expect(page.getByRole("main")).toContainText("No firewall permits, NAT rules or reply routes are created");
  await page.getByRole("button", { name: "Commit & push", exact: true }).click();
  const push = page.getByRole("dialog");
  await expect(push).toContainText("udp_broadcast_relay.write");
  await push.getByRole("button", { name: "Push changes", exact: true }).click();
  await expect(push.getByRole("button", { name: "Confirm changes", exact: true })).toBeEnabled();
  await push.getByRole("button", { name: "Confirm changes", exact: true }).click();
  await expect(push).not.toBeVisible();
  const submitted = backend.writes.find(write => write.path === "/transactions")!.body as PackageRequest;
  expect(submitted.config.udp_broadcast_relay).toEqual({
    ...initial.udp_broadcast_relay, enabled: true,
    instances: [{ id: 1, enabled: true, port: 4001, interfaces: ["lan0", "iot0"], multicast_address: "239.255.255.250", source: "original", metadata: { display_name: "Govee", description: "" } }],
  });
  expect(submitted.config.interfaces).toEqual(initial.interfaces);
  expect(submitted.config.firewall).toEqual(initial.firewall);
  expect(submitted.config.kernel).toEqual(initial.kernel);

  await page.goto("/services/udp-broadcast-relay");
  await expect(view.getByRole("button", { name: "Edit relay 1", exact: true })).toBeEnabled();
  await expect(view.getByRole("button", { name: "Relay 1 details", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await view.getByRole("button", { name: "Presets", exact: true }).click();
  await page.getByText("ECHONET Lite", { exact: true }).click();
  await expect(view.getByLabel("Instance ID", { exact: true })).toHaveValue("2");
  await expect(view.getByLabel("UDP port", { exact: true })).toHaveValue("3610");
  await expect(view.getByLabel("Multicast group (optional)", { exact: true })).toHaveValue("224.0.23.0");
  await expect(view.getByRole("checkbox", { name: "Instance enabled", exact: true })).toHaveCount(0);
  await view.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(dialogs).toEqual([]);
});

test("relay restart is confirmed and runtime errors do not lock local editing", async ({ page }) => {
  const initial = config();
  initial.interfaces.push(...["lan0", "iot0"].map((name, index) => ({
    name, kind: "ethernet" as const, role: "lan" as const, up: true, mtu: 1500,
    addresses: [`192.168.${index + 10}.1/24`], dhcp_relay: { enabled: false, servers: [] },
  })));
  const observed = udpRelayStatus();
  initial.udp_broadcast_relay = { enabled: true, instances: [{ id: 1, enabled: true, port: observed.port, interfaces: observed.interfaces, multicast_address: observed.multicast_address, source: observed.source }] };
  const backend = await mockBackend(page, { initialConfig: initial });
  let restarts = 0;
  await page.route("**/proxy/services/udp-broadcast-relay/status", route => route.fulfill({ json: { instances: [{ ...observed, state: "error", error: "Bind failed", retrying: true }], error: "" } }));
  await page.route("**/proxy/processes/restart", route => {
    restarts++;
    expect(route.request().postDataJSON()).toEqual({ target: "udp-broadcast-relay:1" });
    return route.fulfill({ json: { target: "udp-broadcast-relay:1", status: "restarted", worker: observed } });
  });
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("region", { name: "Overview", exact: true })).toBeVisible();
  await page.goto("/services/udp-broadcast-relay");
  const view = page.getByRole("region", { name: "UDP Broadcast Relay", exact: true });
  await expect(view.getByRole("button", { name: "Restart relay 1", exact: true })).toBeEnabled();
  await view.getByRole("button", { name: "Restart relay 1", exact: true }).click();
  const dialog = page.getByRole("dialog");
  expect(restarts).toBe(0);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(restarts).toBe(0);
  await view.getByRole("button", { name: "Restart relay 1", exact: true }).click();
  await dialog.getByRole("button", { name: "Restart", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(restarts).toBe(1);
  await view.getByRole("button", { name: "Edit relay 1", exact: true }).click();
  await view.getByLabel("Display name", { exact: true }).fill("Retained draft");
  await view.getByRole("button", { name: "Stage changes", exact: true }).click();
  await expect(view).toContainText("Retained draft");
  expect(backend.writes).toEqual([]);
});