import { expect, test } from "@playwright/test";
import { config } from "../fixtures";
import { interfaceCapabilitySnapshot } from "../diagnosticsFixtures";
import { mockBackend } from "./mockBackend";

test("RSS IRQ uses one chip table for enabled physical interfaces", async ({ page }) => {
  const initialConfig = config(), base = initialConfig.interfaces[0]!;
  initialConfig.interfaces = [
    { ...base, name: "eno1", kind: "ethernet", up: true },
    { ...base, name: "eno2", kind: "ethernet", up: true },
    { ...base, name: "eno3", kind: "ethernet", up: false },
    { ...base, name: "vlan10", kind: "vlan", up: true, vlan: { parent: "eno1", id: 10 } },
  ];
  const snapshot = interfaceCapabilitySnapshot(), physical = snapshot.inventory.interfaces[0]!;
  physical.rss = { context: 0, indirection_table: [0, 1, 1, 3], hash_function: 1, input_transformation: 0 };
  physical.capabilities.find(feature => feature.name === "rss")!.enabled = true;
  physical.queues[0]!.irqs = [135];
  physical.interrupts = [{ irq: 135, description: "eno1-TxRx-0", effective_cpus: [1, 7], counts: [], errors: [] }];
  snapshot.inventory.interfaces.push(
    { ...physical, name: "eno2", capabilities: physical.capabilities.map(feature => feature.name === "rss" ? { ...feature, enabled: false } : feature) },
    { ...physical, name: "eno3" },
    { ...physical, name: "vlan10", kind: "vlan" },
  );
  const backend = await mockBackend(page, { initialConfig });
  await page.route("**/interface-capabilities", route => route.fulfill({ json: snapshot }));
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.goto("/diagnostics/rss-irq");

  const panel = page.getByRole("region", { name: "RSS / IRQ observations", exact: true });
  const table = panel.getByRole("table");
  await expect(table).toHaveCount(1);
  await expect(table.locator("tbody tr > th")).toHaveText(["ENO1", "ENO2"]);
  await expect(table.locator("tbody tr").first().locator("td").first().locator(".v-chip")).toHaveClass(/text-success/);
  await expect(table.locator("tbody tr").last().locator("td").first().locator(".v-chip")).toHaveClass(/text-warning/);
  await expect(table.locator("tbody tr").first()).toContainText("135: 1, 7");
  await expect(panel.locator("details")).toHaveCount(0);
  expect(await table.locator("tbody tr").first().evaluate(row => {
    const columns = [...row.querySelectorAll("td")].slice(-3);
    const queues = columns.map(column => [...column.querySelectorAll(".queue-observation")].map(item => item.getBoundingClientRect().top));
    return queues[0]!.every((top, index) => queues.every(column => Math.abs(column[index]! - top) < 1));
  })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(backend.writes).toHaveLength(0);
});
