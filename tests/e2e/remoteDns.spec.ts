import { expect, test } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { config } from "../fixtures";

for (const enabled of [true, false]) {
  test(`General settings stages one DHCP DNS override control (${enabled})`, async ({ page }) => {
    const initial = config();
    initial.interfaces.push({ ...initial.interfaces[0]!, name: "wan0", role: "wan", kind: "ethernet", up: false });
    initial.dns = Object.fromEntries(initial.interfaces.map(link => [
      link.name, { servers: ["192.0.2.53"], domains: [], override_dhcp_dns: !enabled },
    ]));
    const backend = await mockBackend(page, { initialConfig: initial });
    await page.goto("/connect");
    await page.getByLabel("Registry admin password").fill("registry-test-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
    await page.goto("/settings/general");
    const view = page.getByRole("region", { name: "General settings", exact: true });
    const control = view.getByLabel("Ignore DHCP-provided DNS servers", { exact: true });
    await expect(control).toHaveCount(1);
    await control.setChecked(enabled);
    await view.getByRole("button", { name: "Save", exact: true }).click();
    await expect(control).toBeChecked({ checked: enabled });
    await expect(view).toContainText("Interfaces without configured DNS servers still use DHCP DNS");
    expect(backend.writes).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("Remote DNS is accessible under Services and stages resolver settings without backend writes", async ({ page }) => {
  const initial = config();
  initial.interfaces.push({ ...initial.interfaces[0]!, name: "wan0", role: "wan", kind: "ethernet" });
  const backend = await mockBackend(page, { initialConfig: initial });
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("region", { name: "Overview", exact: true })).toBeVisible();
  const hamburger = page.getByRole("button", { name: "Open navigation menu", exact: true });
  if (await hamburger.isVisible()) await hamburger.click();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Services", exact: true }).click();
  const pages = page.getByRole("navigation", { name: "Services pages" });
  const expand = pages.getByRole("button", { name: /^Expand .* navigation$/ });
  if (await expand.isVisible()) await expand.click();
  await pages.getByRole("tab", { name: "Remote DNS", exact: true }).click();
  await expect(page).toHaveURL(/\/services\/remote-dns$/);
  const view = page.getByRole("region", { name: "Remote DNS", exact: true });
  for (const server of ["1.1.1.1", "2606:4700:4700::1111"]) {
    await view.getByRole("button", { name: "Add DNS server", exact: true }).click();
    await view.getByRole("textbox", { name: "DNS server", exact: true }).fill(server);
    await view.getByRole("button", { name: "Save", exact: true }).click();
    await expect(view.getByRole("cell", { name: server, exact: true })).toBeVisible();
  }
  await expect(view.locator("tbody tr")).toHaveCount(2);
  await view.getByRole("button", { name: "Edit 1.1.1.1", exact: true }).click();
  await view.getByRole("textbox", { name: "DNS server", exact: true }).fill("9.9.9.9");
  await view.getByRole("textbox", { name: "DNS server", exact: true }).press("Enter");
  await expect(view.getByRole("cell", { name: "9.9.9.9", exact: true })).toBeVisible();
  await view.getByRole("button", { name: "Delete 9.9.9.9", exact: true }).click();
  await expect(view.locator("tbody tr")).toHaveCount(1);
  expect(backend.writes).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
