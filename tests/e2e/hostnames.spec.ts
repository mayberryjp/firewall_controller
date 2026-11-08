import { expect, test } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { connections, hostPolicyConfig } from "../fixtures";
import { firewallDenyPage } from "../firewallTelemetryFixtures";

for (const useInventory of [false, true]) {
test(`firewall telemetry truncates ${useInventory ? "local descriptions" : "saved host labels"} without changing connection identities`, async ({ page, isMobile }) => {
  const config = hostPolicyConfig();
  const sourceName = `Tablet ${"unbroken".repeat(useInventory ? 30 : 15)}`;
  config.firewall.policies!.hosts[0]!.metadata = { display_name: sourceName, description: "Not displayed" };
  config.firewall.policies!.hosts[0]!.addresses.push("2001:db8::20");
  config.firewall.policies!.hosts[1]!.addresses.push("2001:db8::10");
  const destinationName = `Database ${"long-hostname-".repeat(7)}`.trim();
  config.firewall.policies!.hosts[1]!.metadata = { display_name: destinationName, description: "Not displayed" };
  if (useInventory) {
    config.sando = { api_url: "https://sando.example", sync_enabled: true, hosts_import: null, rules_import: null };
    config.firewall.policies!.hosts[0]!.metadata!.display_name = "Imported DNS tablet";
    config.firewall.policies!.hosts[1]!.metadata!.display_name = "Imported DNS database";
    config.firewall.policies!.hosts.push({ id: "unknown-device", name: "Imported DNS unknown", addresses: ["203.0.113.20"], policy: "drop", rules: [] });
    await page.route("https://sando.example/api/localhosts", route => route.fulfill({ json: [
      { ip_address: "192.0.2.20", ip6_address: "2001:db8::20", local_description: sourceName, dns_hostname: "dns-tablet", dhcp_hostname: "dhcp-tablet" },
      { ip_address: "198.51.100.10", ip6_address: "2001:db8::10", local_description: destinationName, dns_hostname: "dns-database" },
      { ip_address: "203.0.113.20", local_description: null, dns_hostname: "dns-unknown", dhcp_hostname: "dhcp-unknown" },
    ] }));
  }
  const backend = await mockBackend(page, { initialConfig: config });
  const until = Date.parse("2026-11-08T12:34:56.789Z");
  const drops = firewallDenyPage(); drops.next_before_id = null;
  const base = { ...drops.records[0]!, source_port: 65535, destination_port: 65535 };
  drops.records = [
    { ...base, timestamp_ms: until },
    { ...base, id: "18446744073709551613", timestamp_ms: until, source: "2001:db8::20", destination: "2001:db8::10" },
    { ...base, id: "18446744073709551612", timestamp_ms: until, source: "203.0.113.20", destination: "198.51.100.40" },
  ];
  const sample = connections(), original = sample.connections[0]!;
  original.original.source = "192.0.2.20"; original.original.destination = "198.51.100.10";
  original.original.destination_port = 65535;
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
    await expect(view.getByText(`${sourceName.toUpperCase()} (192.0.2.20)`, { exact: true })).toBeVisible();
    await expect(view.getByText(`${sourceName.toUpperCase()} (2001:db8::20)`, { exact: true })).toBeVisible();
    await expect(view.getByText(`${destinationName.toUpperCase()} (198.51.100.10)`, { exact: true })).toBeVisible();
    await expect(view.getByText(`${destinationName.toUpperCase()} (2001:db8::10)`, { exact: true })).toBeVisible();
    await expect(view.getByText("203.0.113.20", { exact: true })).toBeVisible();
    await expect(view.getByText("198.51.100.40", { exact: true })).toBeVisible();
    await expect(view).not.toContainText("Not displayed");
    await expect(view).not.toContainText(/DNS|DHCP/);
    const initialViewport = page.viewportSize()!;
    for (const width of [...new Set([initialViewport.width, 1024, 768, 601, 600, 320])]) {
      await page.setViewportSize({ width, height: initialViewport.height });
      const endpoints = view.locator(".drop-endpoint-value .mono, .endpoint-value .mono, .missing-rule-endpoint > span");
      await expect(endpoints).toHaveCount(6);
      const measurements = await endpoints.evaluateAll(elements => elements.map(element => {
        const style = getComputedStyle(element), bounds = element.getBoundingClientRect();
        const cell = element.closest("td")!.getBoundingClientRect();
        const row = element.parentElement!.getBoundingClientRect();
        const chip = element.parentElement!.querySelector(".v-chip")?.getBoundingClientRect();
        const range = document.createRange(); range.selectNodeContents(element);
        return {
          nowrap: style.whiteSpace === "nowrap",
          ellipsis: style.textOverflow === "ellipsis" && style.overflowX === "hidden",
          title: element.getAttribute("title") === element.textContent,
          singleLine: new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size === 1,
          contained: bounds.left >= cell.left && bounds.right <= cell.right + 1,
          portContained: !chip || (chip.left >= cell.left && chip.right <= cell.right + 1 &&
            chip.top >= row.top && chip.bottom <= row.bottom + 1),
          truncated: element.scrollWidth > element.clientWidth,
        };
      }));
      for (const measurement of measurements) {
        expect(measurement, `${name} at ${width}px`).toMatchObject({ nowrap: true, ellipsis: true, title: true, singleLine: true, contained: true, portContained: true });
      }
      expect(measurements.filter(measurement => measurement.truncated).length).toBeGreaterThanOrEqual(4);
      if (name === "Connections" && width === initialViewport.width && !isMobile) {
        const cells = await view.locator(".connection-row").first().locator("td").evaluateAll(elements =>
          elements.map(element => {
            const bounds = element.getBoundingClientRect();
            return { left: bounds.left, right: bounds.right };
          }));
        for (const cell of cells) {
          expect(cell.left).toBeGreaterThanOrEqual(0);
          expect(cell.right).toBeLessThanOrEqual(width);
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.setViewportSize(initialViewport);
  }
  expect(backend.writes).toEqual([]);
  await page.getByRole("button", { name: "Delete connection 42", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(`${sourceName.toUpperCase()} (192.0.2.20)`);
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
}
