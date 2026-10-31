import { expect, test } from "@playwright/test";
import { config } from "../fixtures";
import { mockBackend } from "./mockBackend";

test("DHCP relay interface labels stay on one compact line", async ({ page }) => {
  const initialConfig = config();
  const link = initialConfig.interfaces[0]!;
  link.metadata = { display_name: "Office network with a deliberately long descriptive interface name ".repeat(2).slice(0, 128), description: "" };
  link.role = "unassigned";
  initialConfig.interfaces.push({ ...link, name: "lab1", role: "lan", metadata: undefined, addresses: ["198.51.100.1/24"] });
  const backend = await mockBackend(page, { initialConfig });
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.goto("/services/dhcp-relay");

  const table = page.getByRole("region", { name: "DHCPv4 relay", exact: true }).locator(".relay-table");
  await expect(table.locator(".relay-interface-name")).toHaveText([link.name, "lab1"]);
  await expect(table.locator(".relay-interface-role")).toHaveText(["Unassigned", "LAN"]);
  const description = table.locator(".relay-interface-description");
  await expect(description).toHaveText(link.metadata.display_name);
  await expect(description).toHaveAttribute("title", link.metadata.display_name);
  expect(await description.evaluate(element => {
    const style = getComputedStyle(element);
    return style.whiteSpace === "nowrap" && style.textOverflow === "ellipsis"
      && element.scrollWidth > element.clientWidth;
  })).toBe(true);
  expect(await table.locator(".relay-interface").first().evaluate(element => {
    const children = [...element.children].map(child => child.getBoundingClientRect());
    return children.every(child => child.top < children[0]!.bottom && child.bottom > children[0]!.top);
  })).toBe(true);
  expect(await table.locator(".relay-interface").first().evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(24);
  const rowHeights = await table.locator("tbody tr").evaluateAll(rows => rows.map(row => row.getBoundingClientRect().height));
  expect(rowHeights[0]).toBe(rowHeights[1]);
  await expect(table.locator("thead th")).toHaveCount(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(backend.writes).toHaveLength(0);
});
