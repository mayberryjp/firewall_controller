import { expect, test } from "@playwright/test";
import { config, state } from "../fixtures";
import { mockBackend } from "./mockBackend";
import { encodeJson } from "../../src/services/json";

test("API Explorer explicitly adopts a VLAN once and refreshes the saved baseline", async ({ page }) => {
  const initialConfig = config();
  initialConfig.interfaces.push({ ...initialConfig.interfaces[0]!, name: "eth0", kind: "ethernet", addresses: ["198.51.100.1/24"] });
  const adoptedInterface = {
    ...initialConfig.interfaces[0]!, name: "vlan30", kind: "vlan" as const, role: "unassigned" as const,
    vlan: { parent: "eth0", id: 30 }, mtu: 1450, addresses: ["198.51.100.30/24"],
  };
  const backend = await mockBackend(page, { initialConfig });
  const posts: unknown[] = [];
  let adopted = false, refreshed = false, complete!: () => void;
  const gate = new Promise<void>(resolve => { complete = resolve; });
  await page.route("**/proxy/interfaces/adopt-vlan", async route => {
    expect(route.request().method()).toBe("POST");
    expect(new URL(route.request().url()).search).toBe("");
    posts.push(route.request().postDataJSON());
    await gate; adopted = true;
    await route.fulfill({ contentType: "application/json", body: encodeJson({ revision: "2026.11.06.9", interface: adoptedInterface }) });
  });
  await page.route("**/proxy/state", route => {
    if (adopted) refreshed = true;
    return route.fulfill({ contentType: "application/json", body: encodeJson({
      ...state(), revision: adopted ? "2026.11.06.9" : "2026.10.29.1",
      desired: { ...initialConfig, interfaces: [...initialConfig.interfaces, ...(adopted ? [adoptedInterface] : [])] },
    }) });
  });
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page).toHaveURL(/\/overview$/);
  await page.goto("/diagnostics/api");
  const explorer = page.getByRole("region", { name: "API explorer", exact: true });
  await explorer.getByRole("combobox", { name: "Appliance API path" }).fill("/api/v1/interfaces/adopt-vlan");
  await page.getByRole("option", { name: "/api/v1/interfaces/adopt-vlan (POST: Adopt existing VLAN)", exact: true }).click();
  await expect(explorer.getByLabel("VLAN adoption JSON", { exact: true })).toBeVisible();
  expect(posts).toEqual([]);
  await explorer.getByLabel("VLAN adoption JSON", { exact: true }).fill('{"name":"vlan30","parent":"eth0","id":30}');
  const submit = explorer.getByRole("button", { name: "POST: Adopt VLAN", exact: true });
  await submit.click();
  await expect.poll(() => posts.length).toBe(1);
  await expect(submit).toBeDisabled();
  await expect(explorer.getByRole("button", { name: "Cancel request", exact: true })).toHaveCount(0);
  complete();
  await expect(explorer.getByLabel("Response body", { exact: true })).toContainText('"revision": "2026.11.06.9"');
  await expect(explorer.getByLabel("Response body", { exact: true })).toContainText('"mtu": 1450');
  expect(refreshed).toBe(true);
  expect(posts).toEqual([{ name: "vlan30", parent: "eth0", id: 30 }]);
  expect(backend.writes).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto("/vlans");
  const row = page.getByRole("region", { name: "VLANs", exact: true }).locator("tbody tr").filter({ hasText: "VLAN30" });
  await expect(row).toContainText("1450");
  await expect(row).toContainText("Unassigned");
});
