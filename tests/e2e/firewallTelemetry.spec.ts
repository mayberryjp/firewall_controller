import { expect, test, type Page } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { hostPolicyConfig } from "../fixtures";
import { dnatRule } from "../bgpFixtures";
import { firewallCounters, firewallDenyPage } from "../firewallTelemetryFixtures";

async function connect(page: Page) {
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("region", { name: "Overview", exact: true })).toBeVisible();
}

test("drop history supports UTC filters, exact cursors and compact screens without details or writes", async ({ page }, testInfo) => {
  const backend = await mockBackend(page);
  const queries: URLSearchParams[] = [];
  await page.route("**/firewall/deny-log*", route => {
    const url = new URL(route.request().url()); queries.push(url.searchParams);
    const response = firewallDenyPage();
    if (url.searchParams.has("before_id")) {
      response.records[0]!.id = "18446744073709551613"; response.next_before_id = null; response.cursor_expired = true;
    }
    return route.fulfill({ json: response });
  });
  await connect(page); await page.goto("/diagnostics/firewall-drops");
  const view = page.getByRole("region", { name: "Firewall drops", exact: true });
  const navigation = page.getByRole("navigation", { name: "Diagnostics pages", exact: true });
  if (testInfo.project.name === "chromium") {
    await expect(page.locator(".section-layout")).toHaveClass(/section-layout--collapsed/);
    await expect(navigation.getByRole("tab")).toHaveCount(0);
    await navigation.getByRole("button", { name: "Expand Diagnostics navigation", exact: true }).click();
    await expect(navigation.getByRole("tab", { name: "FIREWALL DROPS", exact: true })).toHaveAttribute("aria-selected", "true");
    await navigation.getByRole("button", { name: "Collapse Diagnostics navigation", exact: true }).click();
  } else {
    await expect(navigation.getByRole("tab", { name: "FIREWALL DROPS", exact: true })).toBeVisible();
  }
  await expect(view.locator("h1")).toHaveCount(0);
  await expect(view.locator("time")).toHaveText("2026-10-30 12:34:56");
  await expect(view.locator("time")).toHaveAttribute("datetime", "2026-10-30T12:34:56.789Z");
  await expect(view.locator(".drop-table thead th")).toHaveText([
    "Time (UTC)", "Source / port", "Destination / port", "Protocol", "Ingress", "Egress", "Bytes", "Reason",
  ]);
  await expect(view.locator(".drop-row td")).toHaveCount(8);
  await expect(view.getByRole("button", { name: /^Details for drop / })).toHaveCount(0);
  await expect(view.locator(".drop-details")).toHaveCount(0);
  await expect(view.locator('[data-label="Ingress"]')).toHaveText("—");
  await expect(view.locator('[title="Source port 0"]')).toHaveText("0");
  await expect(view.locator('[data-label="Protocol"] .v-chip')).toHaveClass(/text-info/);
  await expect(view.locator('[data-label="Reason"] .v-chip').last()).toHaveClass(/text-error/);
  await expect(view.getByLabel("Since (UTC)")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("firewall-drops.png"), fullPage: true });
  await view.getByRole("button", { name: "Load older", exact: true }).click();
  await expect(view.locator("time")).toHaveCount(2);
  expect(queries.at(-1)!.get("before_id")).toBe("18446744073709551614");
  await expect(view).toContainText("Retention gap");
  await view.getByLabel("Source or destination IP").fill("192.0.2.20");
  await view.getByLabel("IP protocol (0–255)").fill("6");
  await view.getByRole("button", { name: "More filters", exact: true }).click();
  await expect(view.getByRole("button", { name: "More filters", exact: true })).toHaveAttribute("aria-expanded", "true");
  await view.getByLabel("Since (UTC)").fill("2026-10-30 00:00:00");
  await view.getByRole("button", { name: "Apply filters", exact: true }).click();
  await expect(view.locator("time")).toHaveCount(1);
  expect(Object.fromEntries(queries.at(-1)!)).toMatchObject({ address: "192.0.2.20", protocol: "6", since_ms: String(Date.parse("2026-10-30T00:00:00Z")) });
  expect(queries.at(-1)!.has("before_id")).toBe(false); expect(backend.writes).toEqual([]);
});

test("applied host, interface, input and NAT rule counters preserve exact totals and fit compact screens", async ({ page, isMobile }, testInfo) => {
  const settings = hostPolicyConfig();
  settings.firewall.policies!.hosts[2]!.addresses.push("2001:db8::30");
  settings.interfaces.push({ ...settings.interfaces[0]!, name: "wan0", role: "wan", addresses: ["203.0.113.1/24"] });
  settings.firewall.input = { policy: "drop", interfaces: [{ interface: "lab0", rules: [{ protocol: "tcp", destination_ports: [443], action: "accept" }] }] };
  settings.firewall.nat.destination_rewrite = [dnatRule()];
  const backend = await mockBackend(page, { initialConfig: settings });
  const sample = firewallCounters(settings);
  await page.route("**/statistics/firewall", route => route.fulfill({ json: sample }));
  await connect(page);
  for (const path of ["/firewall", "/firewall/ingress", "/firewall/input", "/firewall/nat", "/firewall/nat/dnat"]) {
    await page.goto(path);
    await expect(page.locator(".counter-value").filter({ hasText: /^9007199254740993$/ }).first()).toBeVisible();
    await expect(page.locator(".counter-value").filter({ hasText: /^18446744073709551616$/ }).first()).toBeVisible();
    await expect(page.locator(".app-content")).toContainText("Sampled (UTC): 2026-10-30 12:34:56");
    if (["/firewall", "/firewall/ingress", "/firewall/input"].includes(path)) {
      const system = page.locator(".host-rules-table");
      await expect(system).toHaveCount(1);
      await expect(system.locator("thead")).toHaveCount(1);
      await expect(system.locator(".rule-section-heading")).toHaveText(path === "/firewall"
        ? ["System Rules", "Interface Overrides", "Host Rules", "Default Rules"] : ["System Rules", "User Rules", "Default Rules"]);
      if (path === "/firewall") {
        await expect(system.getByRole("columnheader", { name: "Ingress", exact: true })).toBeVisible();
        await expect(system.locator(".interface-rule .rule-value--ingress")).toHaveText(["lab0"]);
        await expect(system.locator(".interface-rule").locator("button, input, select")).toHaveCount(0);
        await expect(system.locator(".system-rule--default .rule-value--order")).toHaveText("Global");
      }
      await expect(system).toBeVisible();
      await expect(system.locator(".system-rule")).toHaveCount(path === "/firewall/input" ? 4 : 3);
      await expect(system.locator(".system-rule").locator("button, input, select, td > div.text-caption")).toHaveCount(0);
      await expect(system.locator(".system-rule").first()).toContainText("ICMP");
      await expect(system.locator(".system-rule").first()).toContainText("accept");
      await expect(system.locator(".system-rule--default .counter-value").first()).toHaveText("0");
      await expect(page.locator(".host-rules-table .counter-summary")).toHaveCount(0);
      if (path === "/firewall/input") {
        await expect(system.locator(".system-rule").nth(1)).toHaveAttribute("title", /Ingress: lo/);
        await expect(system.locator(".system-rule").nth(2)).toHaveAttribute("title", /Connection state: established, related/);
        await expect(system.locator(".system-rule--default")).toHaveAttribute("data-action", "drop");
      }
    }
    if (!isMobile && ["/firewall", "/firewall/ingress", "/firewall/input"].includes(path)) {
      const row = page.locator(".host-rule").first();
      await expect(row).toHaveCSS("display", "table-row");
      await expect(row.locator(".counter-label").first()).toBeHidden();
      for (const rule of await page.locator(".host-rule, .system-rule, .interface-rule").all()) {
        expect((await rule.boundingBox())!.height, `${path}: ${await rule.locator(".rule-value").first().innerText()}`).toBeLessThanOrEqual(44);
        await expect(rule.locator(".rule-value").first()).toHaveCSS("white-space", "nowrap");
        await expect(rule.locator(".rule-action .v-chip__content")).toHaveCSS("white-space", "nowrap");
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`counters-${path.split("/").filter(Boolean).join("-")}.png`), fullPage: true });
  }
  await page.goto("/firewall");
  await page.getByRole("navigation", { name: "Hosts", exact: true }).getByRole("button", { name: "WORKSTATION (192.0.2.20)", exact: true }).click();
  await page.getByRole("button", { name: "Drag rule 1", exact: true }).hover();
  await page.mouse.down();
  const destination = page.locator('[data-rule-index="1"] .rule-value--order');
  await destination.scrollIntoViewIfNeeded();
  const end = await destination.boundingBox();
  await page.mouse.move(end!.x + end!.width / 2, end!.y + end!.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator(".host-policy-content [role='alert']")).toHaveCount(0);
  await expect(page.locator(".host-rule .counter-value").first()).toHaveText("—");
  await expect(page.locator(".app-content")).toContainText("unapplied firewall edits");
  expect(backend.writes).toEqual([]);
});

test("drop permission and unsupported telemetry errors are actionable rather than healthy empty results", async ({ page }) => {
  await mockBackend(page);
  await page.route("**/firewall/deny-log*", route => route.fulfill({ status: 403, json: { error: "Forbidden" } }));
  await connect(page); await page.goto("/diagnostics/firewall-drops");
  await expect(page.getByRole("alert")).toContainText("firewall.logs.read");
  await expect(page.getByText("No retained drops match these filters.")).toHaveCount(0);
  await page.unroute("**/firewall/deny-log*");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("unavailable");
});
