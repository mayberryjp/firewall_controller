import { expect, test } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { config } from "../fixtures";
import { mdnsSchema } from "../../src/types/domain";

test("mDNS stages discovery, reviews and confirms a full package on desktop and mobile", async ({ page }) => {
  const initial = config();
  initial.interfaces = ["lan0", "lan1"].map((name, index) => ({
    name, kind: "ethernet", role: "lan", up: true, mtu: 1500,
    addresses: [`192.0.${index + 2}.1/24`], dhcp_relay: { enabled: false, servers: [] },
  }));
  initial.routes = []; initial.softflowd = []; initial.firewall.nat.masquerade = [];
  initial.mdns = mdnsSchema.parse({
    interfaces: ["lan0", "lan1"], reflection: { enabled: true },
    metadata: { display_name: "Discovery", description: "Preserved printer discovery" },
  });
  const backend = await mockBackend(page, { initialConfig: initial });
  const dialogs: string[] = [];
  page.on("dialog", async dialog => { dialogs.push(dialog.type()); await dialog.dismiss(); });
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("region", { name: "Overview", exact: true })).toBeVisible();
  await page.goto("/services/mdns");
  const view = page.getByRole("region", { name: "mDNS / Discovery", exact: true });
  await expect(view.getByRole("button", { name: "Add service", exact: true })).toBeVisible();
  await view.getByRole("button", { name: "Add service", exact: true }).click();
  await view.getByLabel("Service 1", { exact: true }).fill("_IPP._TCP");
  await view.getByRole("button", { name: "Add service", exact: true }).click();
  await view.getByLabel("Service 2", { exact: true }).fill("printer.local.");
  await view.getByRole("button", { name: "Add service", exact: true }).click();
  await view.getByLabel("Service 3", { exact: true }).fill("_udp._govee-lan._udp.local.");
  await view.getByRole("button", { name: "Stage changes", exact: true }).click();
  await expect(view.getByLabel("Service 1", { exact: true })).toHaveValue("_ipp._tcp.local.");
  await expect(view.getByLabel("Service 2", { exact: true })).toHaveValue("_udp._govee-lan._udp.local.");
  await expect(view.getByLabel("Service 3", { exact: true })).toHaveValue("printer.local.");
  await expect(view).not.toContainText("Applied discovery status");
  expect(backend.writes).toEqual([]); expect(dialogs).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.getByRole("link", { name: "Save configuration", exact: true }).click();
  await expect(page.getByRole("main")).toContainText("mdns / appliance service");
  await page.getByRole("button", { name: "Commit & push", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("mdns.write");
  await page.getByRole("button", { name: "Push changes", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Confirm changes", exact: true })).toBeEnabled();
  expect(backend.writes[0]).toMatchObject({
    path: "/transactions",
    body: { config: {
      mdns: { ...initial.mdns, enabled: true, reflection: { enabled: true, filters: ["_ipp._tcp.local.", "_udp._govee-lan._udp.local.", "printer.local."] } },
      kernel: initial.kernel, ntp: initial.ntp,
    } },
  });
  await page.getByRole("dialog").getByRole("button", { name: "Confirm changes", exact: true }).click();
  await expect(page.getByRole("region", { name: "Commit detail", exact: true })).toContainText("committed");
  await page.goto("/services/mdns");
  await expect(view.getByLabel("Service 1", { exact: true })).toHaveValue("_ipp._tcp.local.");
  await expect(view.getByLabel("Service 2", { exact: true })).toHaveValue("_udp._govee-lan._udp.local.");
  await expect(view).not.toContainText("Traffic counters and sample times");
  expect(dialogs).toEqual([]);
});
