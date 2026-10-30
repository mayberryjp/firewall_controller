import { expect, test } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { hostPolicyConfig } from "../fixtures";

test("manual forwarding host additions validate inline and persist through SAVE", async ({ page }) => {
  const initialConfig = hostPolicyConfig();
  initialConfig.firewall.policies!.hosts[2]!.addresses.push("2001:db8::30");
  const backend = await mockBackend(page, { initialConfig });
  const dialogs: string[] = [];
  page.on("dialog", async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("region", { name: "Overview", exact: true })).toBeVisible();
  await page.goto("/firewall");
  const hosts = page.getByRole("navigation", { name: "Hosts", exact: true });
  const addHost = hosts.getByRole("button", { name: "Add host", exact: true });
  await expect(addHost).toHaveCSS("background-color", "rgb(74, 144, 217)");
  await addHost.click();
  const form = hosts.getByRole("form", { name: "Add forwarding host" });
  await expect(form.getByLabel("IP address", { exact: true })).toBeFocused();
  await form.getByLabel("IP address", { exact: true }).fill("192.0.2.20");
  await form.getByRole("button", { name: "Add", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText("already belongs to a host");
  await form.getByLabel("IP address", { exact: true }).fill("192.0.2.40");
  await form.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(backend.writes).toHaveLength(0);
  await addHost.click();
  await form.getByLabel("IP address", { exact: true }).fill("192.0.2.40");
  await form.getByLabel("IP address", { exact: true }).press("Enter");
  await expect(form).toHaveCount(0);
  const host = hosts.getByRole("button", { name: "192.0.2.40 (192.0.2.40)", exact: true });
  await expect(host).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("table", { name: "Host rules", exact: true }).locator(".host-rule--default")).toContainText("drop");
  expect(dialogs).toEqual([]);
  expect(backend.writes).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("link", { name: "Save configuration", exact: true }).click();
  await page.getByRole("button", { name: "Commit & push", exact: true }).click();
  await page.getByRole("button", { name: "Push changes", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(backend.writes.find(write => write.path === "/transactions")?.body).toMatchObject({
    config: { firewall: { policies: { hosts: expect.arrayContaining([
      { id: "host_192_0_2_40", name: "192.0.2.40", addresses: ["192.0.2.40"], policy: "drop", rules: [] },
    ]) } } },
  });
  await page.goto("/firewall");
  await expect(host).toBeVisible();
});

for (const scope of ["host", "interface", "input"] as const) {
  test(`${scope} rules support inline CRUD and persistent drag ordering`, async ({ page, isMobile }) => {
    const initialConfig = hostPolicyConfig();
    initialConfig.firewall.policies!.hosts[2]!.addresses.push("2001:db8::30");
    initialConfig.firewall.input = { policy: "drop", interfaces: [{ interface: "lab0", rules: [
      { destination: "192.0.2.0/24", action: "accept" }, { action: "drop" },
    ] }] };
    const backend = await mockBackend(page, { initialConfig });
    await page.goto("/connect");
    await page.getByLabel("Registry admin password").fill("registry-test-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.getByRole("region", { name: "Overview", exact: true })).toBeVisible();
    const path = scope === "host" ? "/firewall" : scope === "interface" ? "/firewall/ingress" : "/firewall/input";
    await page.goto(path);
    if (scope === "host") await page.getByRole("button", { name: "WORKSTATION (192.0.2.20)", exact: true }).click();
    const table = page.getByRole("table", { name: scope === "host" ? "Host rules" : scope === "interface" ? "Interface rules" : "Input rules", exact: true });
    await expect(table).toBeVisible();
    if (scope === "input") {
      await page.getByRole("button", { name: "Edit input policy", exact: true }).click();
      await expect(page.getByLabel("Input default policy", { exact: true })).toBeVisible();
      await expect(page.getByLabel("Managed ingress interface", { exact: true })).toHaveCount(0);
      await expect(page.getByLabel("Destination ports", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(table).toBeVisible();
    }
    const originalRows = await table.locator("tr.host-rule").count();
    await page.getByRole("button", { name: "Add rule", exact: true }).click();
    const editor = table.locator(".rule-editor");
    await expect(editor).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await editor.getByLabel("Destination network (blank = Any)", { exact: true }).fill("198.51.100.0/24");
    await editor.getByLabel("Protocol", { exact: true }).press("Enter");
    await page.getByRole("option", { name: "TCP", exact: true }).click();
    await editor.getByLabel("Destination ports (comma separated)", { exact: true }).fill("443, 8443");
    await editor.getByRole("button", { name: "Save rule", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(table.locator("tr.host-rule")).toHaveCount(originalRows + 1);
    const addedNumber = scope === "host" ? originalRows : originalRows + 1;
    await page.getByRole("button", { name: `Edit rule ${addedNumber}`, exact: true }).click();
    await editor.getByLabel("Destination ports (comma separated)", { exact: true }).fill("443");
    await editor.getByRole("button", { name: "Save rule", exact: true }).click();
    await expect(table.getByRole("button", { name: /^Move rule .* (up|down)$/ })).toHaveCount(0);
    const source = page.getByRole("button", { name: `Drag rule ${addedNumber}`, exact: true });
    const target = table.locator('[data-rule-index="0"]');
    await source.scrollIntoViewIfNeeded();
    if (isMobile) {
      const start = await source.boundingBox();
      const session = await page.context().newCDPSession(page);
      const x = start!.x + start!.width / 2, y = start!.y + start!.height / 2;
      await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      await target.evaluate(element => element.scrollIntoView({ block: "center" }));
      const end = await target.boundingBox();
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: end!.x + end!.width / 2, y: end!.y + end!.height / 2 }] });
      await expect(target).toHaveClass(/rule-drop-target/);
      await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await session.detach();
    } else {
      const start = await source.boundingBox();
      await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2);
      await page.mouse.down();
      await page.mouse.move(start!.x + start!.width / 2 + 8, start!.y + start!.height / 2, { steps: 3 });
      const destination = target.locator(".rule-value--order");
      await destination.scrollIntoViewIfNeeded();
      const end = await destination.boundingBox();
      await page.mouse.move(end!.x + end!.width / 2, end!.y + end!.height / 2, { steps: 10 });
      await expect(target).toHaveClass(/rule-drop-target/);
      await page.mouse.up();
    }
    await expect(target.locator(".rule-value").nth(scope === "host" ? 2 : 1)).toHaveText("198.51.100.0/24");
    await expect(target.locator(".rule-value").nth(scope === "host" ? 4 : 3)).toHaveText("443");
    if (scope === "host") await expect(table.locator("tr.host-rule").last()).toHaveClass(/host-rule--default/);
    await page.getByRole("button", { name: "Delete rule 1", exact: true }).click();
    await expect(table.locator("tr.host-rule")).toHaveCount(originalRows);
    expect(backend.writes).toHaveLength(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
