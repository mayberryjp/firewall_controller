import { expect, test } from "@playwright/test";
import { config, statistics } from "../fixtures";
import { mockBackend } from "./mockBackend";

test("overview interface labels stay compact without table overflow or wrapping", async ({ page }, testInfo) => {
  const initialConfig = config();
  const link = initialConfig.interfaces[0]!;
  link.metadata = { display_name: "Office network with a deliberately long descriptive interface name ".repeat(2).slice(0, 128).trim(), description: "" };
  link.role = "unassigned";
  const samples = statistics();
  samples.sample.status = "available";
  samples.interfaces[0]!.status = "available";
  samples.interfaces[0]!.counters = {
    rx_packets: "1250000", tx_packets: "2450000", rx_bytes: "18446744073709551615",
    tx_bytes: "84200", rx_errors: "0", tx_errors: "0",
  };
  const backend = await mockBackend(page, { initialConfig, statistics: samples, discoveredInterfaces: [{
    name: link.name, kind: "dummy", index: 1, mac: null, mtu: 1500, up: true, ownership: "managed",
    role: null, addressing_type: null,
    addresses: ["192.0.2.10/24", "2001:db8:1234:5678:90ab:cdef:1234:5678/64"],
  }] });
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();

  for (const title of ["Interfaces", "Interface counters"]) {
    const widget = page.getByRole("region", { name: title, exact: true });
    await expect(widget.locator(".interface-description")).toHaveText(link.metadata.display_name);
    await expect(widget.locator(".interface-description")).toHaveAttribute("title", link.metadata.display_name);
    await expect(widget.locator(".interface-role")).toHaveText("Unassigned");
    expect(await widget.locator(".v-table__wrapper").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await widget.locator(".interface-description").evaluate(element => {
      const style = getComputedStyle(element);
      return style.whiteSpace === "nowrap" && style.textOverflow === "ellipsis"
        && element.scrollWidth > element.clientWidth
        && element.getBoundingClientRect().height <= 14;
    })).toBe(true);
    expect(await widget.locator(".interface-role").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await widget.locator(".interface-name").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await widget.locator("tbody tr").first().evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(40);
  }
  const counters = page.getByRole("region", { name: "Interface counters", exact: true });
  await expect(counters.getByRole("link", { name: link.name, exact: true })).toHaveAttribute("href", `/diagnostics/traffic?interface=${link.name}`);
  await expect(counters.locator('td[title="18446744073709551615"]')).toContainText("18.45 EB");
  expect(await counters.locator(".counter-value > span").evaluateAll(elements => elements.every(element => element.scrollWidth <= element.clientWidth))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(backend.writes).toHaveLength(0);
  await page.screenshot({ path: testInfo.outputPath("overview-interface-labels.png"), fullPage: true });
});
