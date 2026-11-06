import { expect, test } from "@playwright/test";
import { config } from "../fixtures";
import { mockBackend } from "./mockBackend";

test("uppercase alphabetical interface lists preserve saved names and edit the original record", async ({ page, isMobile }) => {
  const initialConfig = config(), base = initialConfig.interfaces[0]!;
  initialConfig.interfaces = ["wan0", "eth2", "eth10"].map((name, index) => ({
    ...base, name, kind: "ethernet", metadata: undefined, addresses: [`192.0.${index + 2}.1/24`],
  }));
  initialConfig.routes = [];
  initialConfig.softflowd = [];
  initialConfig.firewall.nat.masquerade = [];
  const backend = await mockBackend(page, { initialConfig, discoveredInterfaces: initialConfig.interfaces.map((link, index) => ({
    name: link.name, kind: link.kind, index: index + 2, mac: null, mtu: link.mtu, up: link.up,
    addresses: link.addresses, ownership: "managed", role: null, addressing_type: null,
  })) });
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL(/\/overview$/);
  await page.goto("/interfaces");
  const view = page.getByRole("region", { name: "Physical interfaces", exact: true });
  await expect(view.locator("tbody tr td:first-child")).toHaveText([/^Name\s*ETH10$/, /^Name\s*ETH2$/, /^Name\s*WAN0$/]);
  await view.getByRole("cell", { name: "ETH10", exact: true }).click();
  const editor = page.getByRole("row", { name: "Configure eth10", exact: true });
  await editor.getByLabel("MTU", { exact: true }).fill("1450");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(view.locator("tbody tr").first()).toContainText("1450");
  if (isMobile) await page.getByRole("button", { name: "Open navigation menu", exact: true }).click();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Routing", exact: true }).click();
  await page.getByRole("button", { name: "Add Static Route", exact: true }).click();
  await page.getByLabel("Gateway interface", { exact: true }).press("ArrowDown");
  const choices = page.getByRole("option");
  await expect(choices.filter({ hasText: /^(ETH10|ETH2|WAN0)$/ })).toHaveText(["ETH10", "ETH2", "WAN0"]);
  await page.getByRole("option", { name: "ETH2", exact: true }).click();
  await page.getByLabel("Destination network", { exact: true }).fill("192.0.3.0/24");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("link", { name: "Save configuration", exact: true }).click();
  await page.getByRole("button", { name: "Commit & push", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Push changes", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Confirm changes", exact: true })).toBeEnabled();
  expect(backend.writes.find(write => write.path === "/transactions")!.body).toMatchObject({
    config: {
      interfaces: [
        { name: "wan0", mtu: base.mtu }, { name: "eth2", mtu: base.mtu }, { name: "eth10", mtu: 1450 },
      ],
      routes: [{ destination: "192.0.3.0/24", interface: "eth2" }],
    },
  });
  await dialog.getByRole("button", { name: "Confirm changes", exact: true }).click();
  await expect(dialog).not.toBeVisible();
});
