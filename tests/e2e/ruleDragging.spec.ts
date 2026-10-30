import { expect, test } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { bgpConfig, dnatRule } from "../bgpFixtures";
import type { PackageRequest } from "../../src/types/domain";

function rotate<T>(rules: T[]): void {
  rules.push(rules.shift()!);
}

for (const scope of ["legacy", "masquerade", "dnat"] as const) {
  test(`${scope} uses drag handles and persists evaluation order through SAVE`, async ({ page, isMobile }) => {
    const initialConfig = bgpConfig();
    initialConfig.firewall.rules = [
      { source: "192.0.2.0/24", action: "accept" },
      { source: "198.51.100.0/24", action: "drop" },
      { source: "203.0.113.0/24", action: "accept" },
    ];
    initialConfig.firewall.nat.masquerade = [
      { family: "ipv4", out_interface: "wan0", source: "192.0.2.0/24" },
      { family: "ipv4", out_interface: "wan0", source: "198.51.100.0/24" },
      { family: "ipv4", out_interface: "wan0", source: "203.0.113.0/24" },
    ];
    initialConfig.firewall.nat.destination_rewrite = [53, 54, 55].map(port => ({ ...dnatRule(), destination_port: port }));
    const backend = await mockBackend(page, { initialConfig });
    const dialogs: string[] = [];
    page.on("dialog", async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
    await page.goto("/connect");
    await page.getByLabel("Registry admin password").fill("registry-test-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.getByRole("region", { name: "Overview", exact: true })).toBeVisible();
    const path = scope === "legacy" ? "/firewall" : scope === "masquerade" ? "/nat" : "/firewall/nat/dnat";
    await page.goto(path);
    const source = page.getByRole("button", { name: scope === "dnat" ? "Drag DNAT rule 1" : "Drag rule 1", exact: true });
    const target = page.locator('[data-rule-index="2"]');
    await expect(page.getByRole("button", { name: /^Move .* (up|down)$/ })).toHaveCount(0);
    await expect(source).toHaveCSS("touch-action", "none");
    await source.scrollIntoViewIfNeeded();
    const start = await source.boundingBox();
    const x = start!.x + start!.width / 2, y = start!.y + start!.height / 2;
    if (isMobile) {
      const session = await page.context().newCDPSession(page);
      await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      await target.evaluate(element => element.scrollIntoView({ block: "center" }));
      const end = await target.boundingBox();
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: end!.x + end!.width / 2, y: end!.y + end!.height / 2 }] });
      await expect(target).toHaveClass(/rule-drop-target/);
      await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await session.detach();
    } else {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await target.scrollIntoViewIfNeeded();
      const end = await target.boundingBox();
      await page.mouse.move(end!.x + end!.width / 2, end!.y + end!.height / 2, { steps: 10 });
      await expect(target).toHaveClass(/rule-drop-target/);
      await page.mouse.up();
    }
    await expect(page.locator('[data-rule-index="0"]')).toContainText(scope === "dnat" ? "54" : "198.51.100.0/24");
    expect(backend.writes).toHaveLength(0);
    expect(dialogs).toEqual([]);
    await page.getByRole("link", { name: "Save configuration", exact: true }).click();
    await page.getByRole("button", { name: "Commit & push", exact: true }).click();
    await page.getByRole("button", { name: "Push changes", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm changes", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const submitted = backend.writes.find(write => write.path === "/transactions")!.body as PackageRequest;
    const expected = structuredClone(initialConfig);
    if (scope === "legacy") rotate(expected.firewall.rules);
    else if (scope === "masquerade") rotate(expected.firewall.nat.masquerade);
    else rotate(expected.firewall.nat.destination_rewrite!);
    expect(submitted.config.firewall).toEqual(expected.firewall);
    await page.reload();
    await page.goto(path);
    await expect(page.locator('[data-rule-index="0"]')).toContainText(scope === "dnat" ? "54" : "198.51.100.0/24");
  });
}
