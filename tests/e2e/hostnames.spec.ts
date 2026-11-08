import { expect, test } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { connections, hostPolicyConfig } from "../fixtures";
import { firewallDenyPage } from "../firewallTelemetryFixtures";

test("firewall telemetry shows named IPv4 and IPv6 endpoints without changing connection identities", async ({ page }) => {
  const config = hostPolicyConfig();
  config.firewall.policies!.hosts[0]!.name = "Sando";
  config.firewall.policies!.hosts[0]!.addresses.push("2001:db8::20");
  config.firewall.policies!.hosts[1]!.addresses.push("2001:db8::10");
  const destinationName = `Database ${"long-hostname-".repeat(7)}`.trim();
  config.firewall.policies!.hosts[1]!.metadata = { display_name: destinationName, description: "Not displayed" };
  const backend = await mockBackend(page, { initialConfig: config });
  const until = Date.parse("2026-11-08T12:34:56.789Z");
  const drops = firewallDenyPage(); drops.next_before_id = null;
  const base = drops.records[0]!;
  drops.records = [
    { ...base, timestamp_ms: until },
    { ...base, id: "18446744073709551613", timestamp_ms: until, source: "2001:db8::20", destination: "2001:db8::10" },
    { ...base, id: "18446744073709551612", timestamp_ms: until, source: "203.0.113.20", destination: "198.51.100.40" },
  ];
  const sample = connections(), original = sample.connections[0]!;
  original.original.source = "192.0.2.20"; original.original.destination = "198.51.100.10";
  sample.connections = [
    original,
    { ...original, id: "43", family: "ipv6", original: { ...original.original, source: "2001:db8::20", destination: "2001:db8::10" }, reply: { ...original.reply, source: "2001:db8::10", destination: "2001:db8::20" } },
    { ...original, id: "44", original: { ...original.original, source: "203.0.113.20", destination: "198.51.100.40" } },
  ];
  sample.summary = { total: 3, matched: 3, returned: 3, accounting_unavailable: 3 };
  await page.route("**/firewall/deny-log*", route => route.fulfill({ json: drops }));
  await page.route("**/statistics/connections*", route => route.fulfill({ json: sample }));
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("region", { name: "Overview", exact: true })).toBeVisible();
  await page.clock.setFixedTime(until);
  for (const [path, name] of [
    ["/diagnostics/firewall-drops", "Firewall drops"],
    ["/diagnostics/possible-missing-rules", "Possible missing rules"],
    ["/connections", "Connections"],
  ]) {
    await page.goto(path!);
    const view = page.getByRole("region", { name: name!, exact: true });
    await expect(view.getByText("SANDO (192.0.2.20)", { exact: true })).toBeVisible();
    await expect(view.getByText("SANDO (2001:db8::20)", { exact: true })).toBeVisible();
    await expect(view.getByText(`${destinationName.toUpperCase()} (198.51.100.10)`, { exact: true })).toBeVisible();
    await expect(view.getByText(`${destinationName.toUpperCase()} (2001:db8::10)`, { exact: true })).toBeVisible();
    await expect(view.getByText("203.0.113.20", { exact: true })).toBeVisible();
    await expect(view.getByText("198.51.100.40", { exact: true })).toBeVisible();
    await expect(view).not.toContainText("Not displayed");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(backend.writes).toEqual([]);
  await page.getByRole("button", { name: "Delete connection 42", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("SANDO (192.0.2.20)");
  await expect(dialog).toContainText(`${destinationName.toUpperCase()} (198.51.100.10)`);
  expect(backend.writes).toEqual([]);
  const deletion = page.waitForRequest(request => request.method() === "DELETE" && new URL(request.url()).pathname.endsWith("/connections/42"));
  await dialog.getByRole("button", { name: "Delete state", exact: true }).click();
  expect((await deletion).postDataJSON()).toEqual({ family: "ipv4", protocol: 6, zone: 0, original: original.original });
  await expect(dialog).not.toBeVisible();
  expect(backend.writes).toEqual([expect.objectContaining({
    path: "/connections/42",
    body: { family: "ipv4", protocol: 6, zone: 0, original: original.original },
  })]);
});
