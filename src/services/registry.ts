import axios from "axios";
import { ref } from "vue";
import { z } from "zod";
import { overviewLayoutSchema, type OverviewLayout } from "./overviewLayout";

const configuredBase = import.meta.env.VITE_REGISTRY_API_URL;
const baseUrl = configuredBase ? new URL(configuredBase) : new URL(window.location.origin);
if (!configuredBase) {
  baseUrl.port = "3031";
  baseUrl.pathname = "/api/v1";
}
if (!["http:", "https:"].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password ||
  baseUrl.search || baseUrl.hash || !baseUrl.pathname.replace(/\/+$/, "").endsWith("/api/v1")) {
  throw new Error("Registry API URL must be an http(s) URL ending in /api/v1 without credentials, query or fragment");
}
export const registryApiBaseUrl = baseUrl.origin + baseUrl.pathname.replace(/\/+$/, "");

const tokenSchema = z.object({ token: z.string().min(1), expires_in: z.number().int().positive() }).strict();
const deviceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  address: z.string().url(),
  created_at: z.string(),
  updated_at: z.string(),
}).strict();
const devicesSchema = z.object({ devices: z.array(deviceSchema) }).strict();
const deviceResponseSchema = z.object({ device: deviceSchema }).strict();
const deletedSchema = z.object({ deleted: z.literal(true) }).strict();

export type RegistryDevice = z.infer<typeof deviceSchema>;
export interface RegistryDeviceInput {
  name: string;
  address: string;
  credential?: string;
}

const sessionToken = ref("");
export const registryDeviceStorageKey = `firewall-controller:${registryApiBaseUrl}:device`;

export function getRememberedRegistryDevice(): string {
  try {
    const value = localStorage.getItem(registryDeviceStorageKey);
    return z.string().uuid().safeParse(value).success ? value! : "";
  } catch { return ""; }
}

export function rememberRegistryDevice(value: string): void {
  try {
    if (value) localStorage.setItem(registryDeviceStorageKey, value);
    else localStorage.removeItem(registryDeviceStorageKey);
  } catch { return; }
}

class RegistryFailure extends Error {
  constructor(message: string, public status?: number) { super(message); }
}

const registry = axios.create({
  baseURL: registryApiBaseUrl,
  timeout: 15_000,
  adapter: "fetch",
  fetchOptions: { redirect: "error", credentials: "omit", cache: "no-store" },
  headers: { Accept: "application/json" },
});

function requestHeaders(): Record<string, string> {
  if (!sessionToken.value) throw new Error("Sign in to the device registry first");
  return { Authorization: `Bearer ${sessionToken.value}` };
}

export function getRegistrySessionToken(): string {
  return sessionToken.value;
}

export function setRegistrySessionToken(value: string): void {
  sessionToken.value = value;
}

async function call<T>(method: "GET" | "POST", path: string, schema: z.ZodType<T>, body?: unknown, authenticated = true, durableSession = false): Promise<T> {
  try {
    const response = await registry.request<unknown>({
      method,
      url: path,
      data: body,
      headers: authenticated ? requestHeaders() : {},
      withCredentials: durableSession,
    });
    const parsed = schema.safeParse(response.data);
    if (!parsed.success) throw new Error(`Incompatible device registry response: ${parsed.error.message}`);
    return parsed.data;
  } catch (error) {
    if (error instanceof Error && !axios.isAxiosError(error)) throw error;
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 401) setRegistrySessionToken("");
      const message = error.response?.data && typeof error.response.data === "object" &&
        "error" in error.response.data && typeof error.response.data.error === "string"
        ? error.response.data.error
        : "Device registry request failed. Check the registry address and availability.";
      throw new RegistryFailure(message, error.response?.status);
    }
    throw error;
  }
}

export async function loginRegistry(password: string): Promise<void> {
  const response = await call("POST", "/session", tokenSchema, { password }, false, true);
  setRegistrySessionToken(response.token);
}

export async function restoreRegistrySession(): Promise<boolean> {
  if (sessionToken.value) return true;
  try {
    const response = await call("GET", "/session", tokenSchema, undefined, false, true);
    setRegistrySessionToken(response.token);
    return true;
  } catch (error) {
    if (error instanceof RegistryFailure && error.status === 401) return false;
    throw error;
  }
}

export async function logoutRegistry(): Promise<void> {
  await call("POST", "/session/logout", deletedSchema, {}, false, true);
  setRegistrySessionToken("");
  rememberRegistryDevice("");
}

export async function listRegistryDevices(): Promise<RegistryDevice[]> {
  return (await call("GET", "/devices", devicesSchema)).devices;
}

export async function createRegistryDevice(device: RegistryDeviceInput): Promise<RegistryDevice> {
  return (await call("POST", "/devices", deviceResponseSchema, device)).device;
}

export async function updateRegistryDevice(id: string, device: RegistryDeviceInput): Promise<RegistryDevice> {
  return (await call("POST", `/devices/${encodeURIComponent(id)}/update`, deviceResponseSchema, device)).device;
}

export async function deleteRegistryDevice(id: string): Promise<void> {
  await call("POST", `/devices/${encodeURIComponent(id)}/delete`, deletedSchema, {});
}

export async function getOverviewLayout(): Promise<OverviewLayout> {
  return call("GET", "/preferences/overview", overviewLayoutSchema);
}

export async function saveOverviewLayout(layout: OverviewLayout): Promise<OverviewLayout> {
  return call("POST", "/preferences/overview", overviewLayoutSchema, overviewLayoutSchema.parse(layout));
}
