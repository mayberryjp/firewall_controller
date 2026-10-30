import { expect, test, type Locator, type Page } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { config, hostPolicyConfig } from "../fixtures";
import { configSchema } from "../../src/types/domain";
import { record } from "../../src/types/forms";

async function choose(page: Page, editor: Locator, label: string, value: string) {
  await editor.getByLabel(label, { exact: true }).press("Enter");
  await page.getByRole("option", { name: value, exact: true }).click();
}

for (const scope of ["host", "interface", "input", "legacy"] as const) {
  test(`${scope} filters preserve ICMP and ICMPv6 with port clearing and confirmed transactions`, async ({ page }) => {
    const initial = scope === "legacy" ? config() : hostPolicyConfig();
    if (initial.firewall.policies) {
      initial.firewall.policies.hosts[0]!.addresses.push("2001:db8::20");
      initial.firewall.policies.hosts[2]!.addresses.push("2001:db8::30");
    }
    initial.firewall.input = { policy: "drop", interfaces: [{ interface: "lab0", rules: [] }] };
    const backend = await mockBackend(page, { initialConfig: initial });
    await page.goto("/connect");
    await page.getByLabel("Registry admin password").fill("registry-test-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.getByRole("region", { name: "Overview", exact: true })).toBeVisible();
    const path = scope === "interface" ? "/firewall/ingress" : scope === "input" ? "/firewall/input" : "/firewall";
    await page.goto(path);
    if (scope === "host") await page.getByRole("button", { name: /WORKSTATION \(/ }).click();
    if (scope === "legacy") {
      await page.getByRole("button", { name: "Add rule", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await choose(page, dialog, "Protocol", "TCP");
      await dialog.getByLabel("Destination network (blank = Any)", { exact: true }).fill("203.0.113.0/24");
      await dialog.getByLabel("Destination ports (comma separated)", { exact: true }).fill("8443, 443");
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      const row = page.getByRole("row").filter({ has: page.getByRole("cell", { name: "203.0.113.0/24", exact: true }) });
      await expect(row).toContainText("8443, 443");
      await row.getByRole("button", { name: "Edit / stage", exact: true }).click();
      await expect(dialog.getByLabel("Destination ports (comma separated)", { exact: true })).toHaveValue("8443, 443");
      await choose(page, dialog, "Protocol", "UDP");
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      await expect(row).toContainText("UDP");
      await expect(row).toContainText("8443, 443");
    }
    for (const protocol of ["icmp", "icmpv6"] as const) {
      await page.getByRole("button", { name: "Add rule", exact: true }).click();
      const editor = scope === "legacy" ? page.getByRole("dialog") : page.locator(".rule-editor");
      await editor.getByLabel("Protocol", { exact: true }).press("Enter");
      await expect(page.getByRole("option")).toHaveText(["Any", "TCP", "UDP", "ICMP", "ICMPv6"]);
      await page.getByRole("option", { name: "TCP", exact: true }).click();
      const ports = editor.getByLabel("Destination ports (comma separated)", { exact: true });
      await ports.fill("443, 8443");
      await choose(page, editor, "Protocol", protocol === "icmp" ? "ICMP" : "ICMPv6");
      await expect(ports).toBeDisabled();
      await expect(ports).toHaveValue("");
      await editor.getByLabel("Destination network (blank = Any)", { exact: true }).fill(protocol === "icmp" ? "198.51.100.0/24" : "2001:db8:2::/64");
      await choose(page, editor, "Action", "drop");
      await expect(editor).toContainText(protocol === "icmp" ? "global IPv4 ICMP exception" : "neighbor discovery");
      await editor.getByRole("button", { name: scope === "legacy" ? "Save" : "Save rule", exact: true }).click();
      await expect(editor).toHaveCount(0);
      await expect(page.getByRole("row").filter({ has: page.getByText(protocol === "icmp" ? "ICMP" : "ICMPv6", { exact: true }) }).last()).toContainText("drop");
    }
    expect(backend.writes).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("link", { name: "Save configuration", exact: true }).click();
    await page.getByRole("button", { name: "Commit & push", exact: true }).click();
    await page.getByRole("button", { name: "Push changes", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Confirm changes", exact: true })).toBeEnabled();
    const submitted = configSchema.parse(record(backend.writes[0]!.body).config);
    if (scope === "legacy") expect(submitted.firewall.rules[1]).toMatchObject({ protocol: "udp", destination_ports: [8443, 443] });
    const rules = scope === "legacy" ? submitted.firewall.rules : scope === "input" ? submitted.firewall.input!.interfaces[0]!.rules
      : scope === "interface" ? submitted.firewall.policies!.interfaces[0]!.rules : submitted.firewall.policies!.hosts[0]!.rules;
    expect(rules.slice(-2)).toEqual([
      { origin: "manual", import_source: null, protocol: "icmp", destination: "198.51.100.0/24", action: "drop" },
      { origin: "manual", import_source: null, protocol: "icmpv6", destination: "2001:db8:2::/64", action: "drop" },
    ]);
    await page.getByRole("dialog").getByRole("button", { name: "Confirm changes", exact: true }).click();
    await expect(page.getByRole("region", { name: "Commit detail", exact: true })).toContainText("committed");
    await page.goto(path);
    if (scope === "host") await page.getByRole("button", { name: /WORKSTATION \(/ }).click();
    await expect(page.getByRole("row").filter({ has: page.getByText("ICMPv6", { exact: true }) })).toContainText("drop");
  });
}
