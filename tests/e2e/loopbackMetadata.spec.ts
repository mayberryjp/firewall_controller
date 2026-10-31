import { expect, test } from "@playwright/test";
import type { DiscoveredInterface } from "../../src/types/domain";
import { config, statistics } from "../fixtures";
import { mockBackend } from "./mockBackend";

for (const up of [true, false]) {
  test(`kernel loopbacks keep fixed labels and read-only controls when ${up ? "up" : "down and addressless"}`, async ({ page }, testInfo) => {
    const initialConfig = config();
    initialConfig.interfaces.push({ ...initialConfig.interfaces[0]!, name: "lo-test0", kind: "ethernet", role: "wan", addresses: [] });
    initialConfig.dhcp_clients = { "lo-test0": { client_id: "", hostname: "", route_metric: 0, use_mtu: false, use_domains: "no" } };
    const discovered: DiscoveredInterface[] = [{
      name: "kernel0", kind: "loopback", ownership: "loopback", index: 1, mac: null, mtu: 65536, up,
      addresses: up ? ["127.0.0.1/8", "::1/128"] : [], role: "loopback", addressing_type: "static",
    }, {
      name: "lo-test0", kind: "ethernet", ownership: "managed", index: 2, mac: null, mtu: 1500, up: true,
      addresses: ["192.0.2.99/24"], role: null, addressing_type: null,
    }, {
      name: "lab0", kind: "dummy", ownership: "managed", index: 3, mac: null, mtu: 1500, up: true,
      addresses: ["192.0.2.10/24"], role: null, addressing_type: null,
    }, {
      name: "lo-unmanaged0", kind: "veth", ownership: "unmanaged", index: 4, mac: null, mtu: 1500, up: true,
      addresses: ["198.51.100.10/24"], role: null, addressing_type: null,
    }];
    const samples = statistics();
    samples.interfaces.push({
      ...samples.interfaces[0]!, name: "kernel0", kind: "loopback", ownership: "loopback", admin_up: up, oper_state: up ? "UNKNOWN" : "DOWN",
    });
    const backend = await mockBackend(page, { initialConfig, statistics: samples, discoveredInterfaces: discovered });
    page.on("dialog", dialog => { throw new Error(`Unexpected dialog: ${dialog.message()}`); });
    await page.goto("/connect");
    await page.getByLabel("Registry admin password").fill("registry-test-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("button", { name: "Connect", exact: true }).click();

    const interfaces = page.getByRole("region", { name: "Interfaces", exact: true });
    await expect(interfaces).toBeVisible();
    const loopback = interfaces.locator("tbody tr").filter({ hasText: "kernel0" });
    await expect(loopback.locator(".interface-role")).toHaveText("Loopback");
    await expect(loopback.locator("td").last()).toHaveText("Static");
    await expect(loopback.locator("td").nth(3)).toHaveText(up ? "127.0.0.1/8::1/128" : "None");
    const managed = interfaces.locator("tbody tr").filter({ hasText: "lo-test0" });
    await expect(managed.locator(".interface-role")).toHaveText("WAN");
    await expect(managed.locator("td").last()).toHaveText("DHCP");
    const unmanaged = interfaces.locator("tbody tr").filter({ hasText: "lo-unmanaged0" });
    await expect(unmanaged.locator(".interface-role")).toHaveCount(0);
    await expect(unmanaged.locator("td").last()).toHaveText("-");
    const counters = page.getByRole("region", { name: "Interface counters", exact: true });
    await expect(counters.locator("tbody tr").filter({ hasText: "kernel0" }).locator(".interface-role")).toHaveText("Loopback");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await page.goto("/interfaces");
    const physical = page.getByRole("region", { name: "Physical interfaces", exact: true });
    await expect(physical.locator("tbody tr").filter({ hasText: "lo-test0" })).toBeVisible();
    await expect(physical.locator("tbody tr").filter({ hasText: "kernel0" })).toHaveCount(0);
    await page.goto("/loopbacks");
    const view = page.getByRole("region", { name: "Loopbacks", exact: true });
    const row = view.locator("tbody tr").filter({ hasText: "kernel0" });
    await expect(row.locator("td").nth(1)).toContainText("Loopback");
    await expect(row.locator("td").nth(5)).toContainText("Static");
    await expect(row).toContainText("Read-only");
    await expect(row.getByRole("button")).toHaveCount(0);
    await expect(row.locator("input, select, [role=combobox]")).toHaveCount(0);
    await expect(view.locator("tbody tr").filter({ hasText: "lo-test0" })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await view.locator(".v-table__wrapper").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("loopback-metadata.png"), fullPage: true });

    await view.locator("tbody tr").filter({ hasText: "lab0" }).getByRole("button", { name: "Edit / stage", exact: true }).click();
    const editor = view.getByRole("row", { name: "Loopback editor", exact: true });
    await editor.locator(".v-select .v-field").click();
    await expect(page.getByRole("option", { name: "Loopback", exact: true })).toHaveCount(0);
    await expect(page.getByRole("option")).toHaveText(["WAN", "LAN", "Unassigned"]);
    expect(backend.writes).toEqual([]);
  });
}
