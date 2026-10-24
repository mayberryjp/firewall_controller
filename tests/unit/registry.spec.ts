import { AxiosError, AxiosHeaders } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getRegistrySessionToken, getRememberedRegistryDevice, loginRegistry, logoutRegistry,
  registryDeviceStorageKey, rememberRegistryDevice, restoreRegistrySession, setRegistrySessionToken,
} from "@/services/registry";
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("axios", async importOriginal => {
  const actual = await importOriginal<typeof import("axios")>();
  return { ...actual, default: { ...actual.default, create: () => ({ request }) } };
});
const device = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  request.mockReset(); setRegistrySessionToken(""); localStorage.clear(); sessionStorage.clear();
});
describe("durable registry session", () => {
  it("logs in with cookies without storing the password or token in web storage", async () => {
    request.mockResolvedValue({ data: { token: "test-session", expires_in: 28800 } });
    await loginRegistry("test-password");
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ url: "/session", method: "POST", withCredentials: true }));
    expect(getRegistrySessionToken()).toBe("test-session");
    expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
  });
  it("restores a validated cookie session to memory without a password", async () => {
    request.mockResolvedValue({ data: { token: "restored-session", expires_in: 1200 } });
    expect(await restoreRegistrySession()).toBe(true);
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ url: "/session", method: "GET", withCredentials: true }));
    expect(getRegistrySessionToken()).toBe("restored-session");
    expect(localStorage.length).toBe(0);
  });
  it("requires login for an expired session but does not hide connection failures", async () => {
    const config = { headers: new AxiosHeaders() };
    request.mockRejectedValueOnce(new AxiosError("Expired", undefined, config, undefined, { status: 401, data: { error: "Registry login required" }, statusText: "", headers: new AxiosHeaders(), config }));
    expect(await restoreRegistrySession()).toBe(false);
    rememberRegistryDevice(device);
    request.mockRejectedValueOnce(new AxiosError("Offline"));
    await expect(restoreRegistrySession()).rejects.toThrow(/request failed/);
    expect(getRememberedRegistryDevice()).toBe(device);
  });
  it("remembers only a valid selected device ID", () => {
    rememberRegistryDevice(device);
    expect(getRememberedRegistryDevice()).toBe(device);
    expect(Object.values(localStorage)).toEqual([device]);
    localStorage.setItem(registryDeviceStorageKey, "not-a-device");
    expect(getRememberedRegistryDevice()).toBe("");
  });
  it("clears the cookie before forgetting the session and selected device on sign-out", async () => {
    setRegistrySessionToken("test-session"); rememberRegistryDevice(device);
    request.mockResolvedValue({ data: { deleted: true } });
    await logoutRegistry();
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ url: "/session/logout", withCredentials: true }));
    expect(getRegistrySessionToken()).toBe(""); expect(getRememberedRegistryDevice()).toBe("");
  });
  it("retains the session when server-side sign-out fails so it can be retried", async () => {
    setRegistrySessionToken("test-session"); rememberRegistryDevice(device);
    request.mockRejectedValue(new AxiosError("Offline"));
    await expect(logoutRegistry()).rejects.toThrow();
    expect(getRegistrySessionToken()).toBe("test-session"); expect(getRememberedRegistryDevice()).toBe(device);
  });
});