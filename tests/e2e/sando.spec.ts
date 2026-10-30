import { expect, test } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { config } from "../fixtures";
import { sandoSchema } from "../../src/services/sandoState";

for (const enabled of [true, false]) test(`Sando automatic sync can be ${enabled ? "enabled" : "disabled"} without importing hosts or rules`, async ({ page }) => {
  const initialConfig = config();
  initialConfig.sando = sandoSchema.parse({ api_url: enabled ? "" : "https://sando.example", sync_enabled: !enabled });
  const backend = await mockBackend(page, { initialConfig });
  const sourceRequests: string[] = [];
  await page.route("https://sando.example/**", route => {
    sourceRequests.push(route.request().url());
    return route.fulfill({ json: [] });
  });
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("region", { name: "Overview", exact: true })).toBeVisible();
  await page.goto("/settings/sando");
  const sync = page.getByLabel("Automatic host and threat-score sync", { exact: true });
  if (enabled) {
    await sync.click();
    await expect(page.getByRole("alert").filter({ hasText: "Save a Sando API endpoint" })).toBeVisible();
    await expect(sync).not.toBeChecked();
    await page.getByLabel("Sando API endpoint", { exact: true }).fill("https://sando.example");
    await page.getByRole("button", { name: "Save endpoint", exact: true }).click();
  }
  await sync.setChecked(enabled);
  await expect(sync).toBeChecked({ checked: enabled });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(backend.writes).toEqual([]);
  expect(sourceRequests).toEqual([]);
  await page.getByRole("link", { name: "Save configuration", exact: true }).click();
  await page.getByRole("button", { name: "Commit & push", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("sando.write");
  await expect(page.getByRole("dialog")).not.toContainText("firewall.write");
  await page.getByRole("button", { name: "Push changes", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm changes", exact: true }).click();
  await expect(page.getByRole("region", { name: "Commit detail", exact: true })).toContainText("committed");
  expect(backend.writes.map(write => write.path)).toEqual(["/transactions", "/transactions/tx-test/confirm"]);
  expect(backend.writes[0]).toMatchObject({ body: { config: {
    sando: { api_url: "https://sando.example", sync_enabled: enabled },
    firewall: initialConfig.firewall,
  } } });
  await page.goto("/settings/sando");
  await expect(sync).toBeChecked({ checked: enabled });
  expect(sourceRequests).toEqual([]);
});

for (const includeID of [true, false]) test(`Sando imports ${includeID ? "identified" : "ID-less"} rules and stages hosts for SAVE on desktop and mobile`, async ({ page }) => {
  const initialConfig = config();
  initialConfig.firewall.rules = []; initialConfig.firewall.policy = "drop";
  initialConfig.sando = sandoSchema.parse({});
  const backend = await mockBackend(page, { initialConfig });
  const requests: string[] = [];
  await page.route("https://sando.example/api/**", route => {
    requests.push(route.request().url());
    expect(route.request().headers().authorization).toBeUndefined();
    const data = route.request().url().endsWith("/localhosts")
      ? [{ ip_address: "192.0.2.20", ip6_address: "2001:db8::20", dhcp_hostname: "desk", icon: "Computer", tags: "trusted" }]
      : [
        { ...(includeID ? { ignorelist_id: "approved" } : {}), src_ip: "192.0.2.20", dst_ip: "198.51.100.40", protocol: 6, dst_port: 443 },
        { src_ip: "192.0.2.20", dst_ip: "*", protocol: 6, dst_port: 8886 },
        { src_ip: "192.0.2.20", dst_ip: "198.51.100.40", protocol: 17, dst_port: "*" },
        { src_ip: "192.0.2.50", dst_ip: "192.0.2.20", protocol: 17, dst_port: 67 },
        { src_ip: "192.0.2.50", dst_ip: "192.0.2.20", protocol: 6, dst_port: 35870 },
        { src_ip: "192.0.2.50", dst_ip: "192.0.2.20", protocol: 6, dst_port: "*" },
        { src_ip: "192.0.2.50", dst_ip: "192.0.2.20", protocol: 17, dst_port: 53 },
      ];
    return route.fulfill({ contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(data) });
  });
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("region", { name: "Overview", exact: true })).toBeVisible();
  await page.goto("/settings/sando");
  await expect(page.getByRole("heading", { name: "SANDO IMPORT", exact: true })).toBeVisible();
  await expect(page.getByLabel("Automatic host and threat-score sync", { exact: true })).not.toBeChecked();
  await expect(page.getByRole("region", { name: "Hosts import report", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Rules import report", exact: true })).toHaveCount(0);
  await expect(page.getByRole("main").locator("p")).toHaveCount(0);
  await page.getByLabel("Sando API endpoint", { exact: true }).fill("https://sando.example");
  await expect(page.getByRole("button", { name: "Import hosts", exact: true })).toBeDisabled();
  await page.getByLabel("Use host/interface policy mode with stateful return traffic instead of legacy forwarding mode").check();
  await page.getByRole("button", { name: "Import hosts", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "1 hosts and 0 rules staged" })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Hosts import report", exact: true })).toHaveCount(0);
  expect(requests).toEqual(["https://sando.example/api/localhosts"]);
  await page.getByRole("button", { name: "Import rules", exact: true }).click();
  await expect(page.getByRole("region", { name: "Review Sando replacement", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Stage reviewed import", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Save configuration", exact: true })).toBeEnabled();
  await expect(page.getByRole("alert").filter({ hasText: "1 hosts and 7 rules staged" })).toBeVisible();
  expect(backend.writes).toEqual([]);
  expect(requests).toContain("https://sando.example/api/ignorelist/ip/192.0.2.20");
  expect(await page.evaluate(() => localStorage.getItem("firewall-controller:sando"))).toBeNull();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("link", { name: "Save configuration", exact: true }).click();
  await expect(page.getByRole("button", { name: "Commit & push", exact: true })).toBeEnabled();
  await expect(page.getByRole("main")).toContainText("firewall-policies");
  expect(backend.writes).toEqual([]);
  await page.getByRole("button", { name: "Commit & push", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("sando.write");
  await expect(page.getByRole("dialog")).toContainText("firewall.write");
  await page.getByRole("button", { name: "Push changes", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Confirm changes", exact: true })).toBeEnabled();
  expect(backend.writes[0]).toMatchObject({ path: "/transactions", body: { config: {
    sando: { api_url: "https://sando.example", sync_enabled: false, hosts_import: { import_count: 1, imported_count: 2 }, rules_import: { import_count: 1, imported_count: 7 } },
    firewall: { policies: { hosts: [{ rules: [
      { destination: "198.51.100.40/32", protocol: "tcp", destination_ports: [443], action: "accept" },
      { destination: "0.0.0.0/0", protocol: "tcp", destination_ports: [8886], action: "accept" },
      { destination: "198.51.100.40/32", protocol: "udp", action: "accept" },
    ] }, { name: "192.0.2.50", addresses: ["192.0.2.50"], policy: "drop", rules: [
      { destination: "192.0.2.20/32", protocol: "udp", destination_ports: [67], action: "accept" },
      { destination: "192.0.2.20/32", protocol: "tcp", destination_ports: [35870], action: "accept" },
      { destination: "192.0.2.20/32", protocol: "tcp", action: "accept" },
      { destination: "192.0.2.20/32", protocol: "udp", destination_ports: [53], action: "accept" },
    ] }] } },
  } } });
  expect(JSON.stringify(backend.writes[0])).not.toContain("dhcp_hostname");
  expect(JSON.stringify(backend.writes[0])).not.toContain('"tags"');
  await page.getByRole("dialog").getByRole("button", { name: "Confirm changes", exact: true }).click();
  await expect(page.getByRole("region", { name: "Commit detail", exact: true })).toContainText("committed");
  await page.goto("/settings/sando");
  await expect(page.getByLabel("Sando API endpoint", { exact: true })).toHaveValue("https://sando.example");
  await expect(page.getByRole("region", { name: "Hosts import report", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Rules import report", exact: true })).toHaveCount(0);
  await expect(page.getByRole("main").locator("h2, p")).toHaveCount(0);
  await expect(page.getByRole("main")).not.toContainText("Pending SAVE:");
  await page.goto("/firewall");
  await page.getByRole("navigation", { name: "Hosts", exact: true }).getByRole("button", { name: "192.0.2.50 (192.0.2.50)", exact: true }).click();
  const rows = page.getByRole("table", { name: "Host rules", exact: true }).locator(".host-rule");
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(2).locator(".rule-value")).toHaveText(["3", "Any", "192.0.2.20/32", "TCP", "Any", "Any", "accept"]);
});
