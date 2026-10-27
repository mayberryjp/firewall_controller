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
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await page.goto("/services/mdns");
  const view = page.getByRole("region", { name: "mDNS / Discovery", exact: true });
  await expect(view).toContainText("State: disabled");
  await view.getByLabel("Enable mDNS", { exact: true }).check();
  await view.getByLabel("Discovery filters", { exact: true }).fill("_IPP._TCP.LOCAL.\nprinter.local.");
  await view.getByRole("button", { name: "Stage settings", exact: true }).click();
  await expect(view.getByLabel("Discovery filters", { exact: true })).toHaveValue("_ipp._tcp.local.\nprinter.local.");
  await expect(view).toContainText("State: disabled");
  expect(backend.writes).toEqual([]); expect(dialogs).toEqual([]);
  await view.getByText("Traffic counters and sample times", { exact: true }).click();
  await expect(view).toContainText("9007199254740993");
  await expect(view).toContainText("18446744073709551615");
  await expect(view).toContainText("2026-10-25 12:00:00");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.getByRole("link", { name: "Save configuration", exact: true }).click();
  await expect(page.getByRole("main")).toContainText("mdns.write");
  await expect(page.getByRole("main")).toContainText("mdns / appliance service");
  await page.getByRole("button", { name: "Commit & push", exact: true }).click();
  await page.getByRole("button", { name: "Push changes", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Confirm changes", exact: true })).toBeEnabled();
  expect(backend.writes[0]).toMatchObject({
    path: "/transactions",
    body: { config: {
      mdns: { ...initial.mdns, enabled: true, reflection: { enabled: true, filters: ["_ipp._tcp.local.", "printer.local."] } },
      kernel: initial.kernel, ntp: initial.ntp,
    } },
  });
  await page.getByRole("dialog").getByRole("button", { name: "Confirm changes", exact: true }).click();
  await expect(page.getByRole("region", { name: "Commit detail", exact: true })).toContainText("committed");
  await page.goto("/services/mdns");
  await expect(view).toContainText("State: simulated");
  await expect(view).toContainText("Applied membership: lan0, lan1");
  expect(dialogs).toEqual([]);
});
