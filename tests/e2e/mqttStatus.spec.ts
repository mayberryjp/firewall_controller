import { expect, test } from "@playwright/test";
import { mockBackend } from "./mockBackend";
import { config, mqttStatus } from "../fixtures";
import { mqttSchema } from "../../src/types/domain";

test("MQTT publisher stays compact through retry, recovery and status errors without changing settings", async ({ page }) => {
  await page.clock.install();
  const initial = config();
  initial.mqtt = mqttSchema.parse({ enabled: true, endpoint: "mqtts://broker.example.test:8883", source_interface: "lab0" });
  const backend = await mockBackend(page, { initialConfig: initial });
  let wire = { ...mqttStatus(), enabled: true, state: "connecting", connection_attempts: 0, reconnect_count: 0 };
  const statusBody = () => JSON.stringify(wire)
    .replace('"connection_attempts":1', '"connection_attempts":18446744073709551615')
    .replace('"reconnect_count":1', '"reconnect_count":9007199254740993');
  let body = statusBody(), denied = false, reads = 0;
  await page.route("**/proxy/services/mqtt/status", route => {
    reads++;
    return route.fulfill({ status: denied ? 403 : 200, contentType: "application/json",
      body: denied ? '{"error":"state.read required"}' : body });
  });
  await page.goto("/connect");
  await page.getByLabel("Registry admin password").fill("registry-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("region", { name: "Overview", exact: true })).toBeVisible();
  await page.goto("/settings/mqtt-streaming");
  const settings = page.getByRole("region", { name: "MQTT STREAMING settings", exact: true });
  const publisher = settings.locator(".setting-row").first();
  await expect(publisher.locator(".setting-desc")).toHaveCount(0);
  await expect(settings.locator("dl")).toHaveCount(0);
  await expect(settings.locator(".v-chip")).toHaveText("connecting");
  await settings.getByLabel("Broker URL", { exact: true }).fill("mqtts://pending.example.test:8883");
  const failure = { category: "connection_reset", message: "MQTT connection reset by peer", os_error_code: 104, at_unix: 1793393503 };
  wire = { ...wire, state: "reconnecting", error: failure.message, last_failure: failure, connection_attempts: 1, reconnect_count: 1 };
  body = statusBody();
  await page.clock.fastForward(8000);
  await expect(settings.locator(".v-chip")).toHaveText("reconnecting");
  await expect(settings).toContainText("Current error: MQTT connection reset by peer");
  await expect(publisher.locator(".setting-desc")).toHaveCount(1);
  const beforeRetry = reads;
  await page.clock.fastForward(8000);
  await expect.poll(() => reads).toBeGreaterThan(beforeRetry);
  await expect(settings).toContainText("Current error: MQTT connection reset by peer");
  wire = { ...wire, state: "running", error: null, last_connected_at_unix: 1793393560, last_published_at_unix: 1793393561 };
  body = statusBody();
  await page.clock.fastForward(8000);
  await expect(settings.locator(".v-chip")).toHaveText("running");
  await expect(settings.locator(".v-chip")).toHaveClass(/text-success/);
  await expect(settings).not.toContainText("Current error:");
  await expect(publisher.locator(".setting-desc")).toHaveCount(0);
  await expect(settings).not.toContainText("MQTT connection reset by peer");
  for (const label of ["Last broker acknowledgment", "Attempts / retries", "Last broker connection", "Last failure", "OS code", "18446744073709551615", "9007199254740993"]) {
    await expect(settings).not.toContainText(label);
  }
  wire = { ...wire, state: "disabled", enabled: false };
  body = statusBody();
  await page.clock.fastForward(8000);
  await expect(settings.locator(".v-chip")).toHaveText("disabled");
  await expect(publisher.locator(".setting-desc")).toHaveCount(0);
  await expect(settings).not.toContainText("Current error:");
  denied = true;
  await page.clock.fastForward(8000);
  await expect(settings).toContainText("HTTP 403: state.read required");
  await expect(settings.locator(".v-chip")).toHaveText("Stale");
  await expect(settings.getByLabel("Broker URL", { exact: true })).toHaveValue("mqtts://pending.example.test:8883");
  await expect(settings.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(backend.writes).toEqual([]);
});
