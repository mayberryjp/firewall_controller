import { expect, test, type Page } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { bgpConfig } from "../bgpFixtures";
import { navigationSections } from "../../src/constants/navigation";
import type { PackageRequest } from "../../src/types/domain";

async function navigate(page: Page, title: string) {
  const section = navigationSections.find(group => group.pages.some(entry => entry.title === title));
  if (!section) throw new Error(`Unknown page: ${title}`);
  const tabs = page.getByRole("navigation", { name: `${section.title} pages` });
  if (!await tabs.isVisible()) {
    if (section.name === "config-section") await page.getByRole("group", { name: "Firewall status" }).getByRole("link", { name: /^Committed revision / }).click();
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
test("BGP peers and DNAT stage inline, preserve the complete package, and survive confirmation", async ({ page }, testInfo) => {
  const initialConfig = bgpConfig(), backend = await mockBackend(page, { initialConfig });
  const dialogs: string[] = [];
  page.on("dialog", async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  const overview = page.getByRole("region", { name: "Overview", exact: true });
  await expect(overview).toBeVisible();
  await expect(overview.getByRole("region", { name: "BGP peers", exact: true })).toContainText("Established");
  await navigate(page, "BGP");
  const bgp = page.getByRole("region", { name: "BGP", exact: true });
  await expect(bgp.locator(".v-chip").filter({ hasText: "Established" })).toHaveClass(/text-success/);
  await expect(bgp).toContainText("connected_or_static_route");
  await bgp.getByRole("button", { name: "Add BGP peer", exact: true }).click();
  await bgp.getByLabel("Peer name", { exact: true }).fill("second");
  await bgp.getByLabel("Peer address", { exact: true }).fill("192.0.2.3");
  await select(page, "Peer interface", "lab0");
  await select(page, "Local address", "192.0.2.10");
  await bgp.getByRole("button", { name: "Save peer", exact: true }).click();
  await expect(bgp).toContainText("second");
  await expect(bgp).toContainText("Not applied");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("bgp-peers.png"), fullPage: true, animations: "disabled" });
  await navigate(page, "DNAT");
  const dnat = page.getByRole("region", { name: "DNAT", exact: true });
  await dnat.getByRole("button", { name: "Add DNAT rule", exact: true }).click();
  await select(page, "WAN", "wan0"); await select(page, "Protocol", "udp"); await select(page, "Target LAN", "lab0");
  await dnat.getByLabel("Target address", { exact: true }).fill("192.0.2.53");
  await dnat.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dnat).toContainText("192.0.2.53");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("dnat.png"), fullPage: true, animations: "disabled" });
  expect(backend.writes).toEqual([]); expect(dialogs).toEqual([]);
  await navigate(page, "SAVE");
  const review = page.getByRole("region", { name: "SAVE", exact: true });
  await expect(review).toContainText("same-subnet direct replies");
  await review.getByRole("button", { name: "Commit & push", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("bgp.write"); await expect(dialog).toContainText("nat.write");
  await dialog.getByRole("button", { name: "Push changes", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Confirm changes", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Confirm changes", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const submitted = backend.writes.find(write => write.path === "/transactions")!.body as PackageRequest;
  expect(submitted.config.bgp!.neighbors).toHaveLength(2);
  expect(submitted.config.firewall.nat.destination_rewrite).toEqual([{ out_interface: "wan0", protocol: "udp", destination_port: 53, target_interface: "lab0", target_address: "192.0.2.53" }]);
  expect(submitted.config.firewall.nat.masquerade).toEqual(initialConfig.firewall.nat.masquerade);
  expect(submitted.config.routes).toEqual(initialConfig.routes);
  expect(submitted.config.interfaces).toEqual(initialConfig.interfaces);
  await page.reload(); await navigate(page, "BGP");
  await expect(page.getByRole("region", { name: "BGP", exact: true })).toContainText("second");
  await navigate(page, "DNAT");
  await expect(page.getByRole("region", { name: "DNAT", exact: true })).toContainText("192.0.2.53");
});
