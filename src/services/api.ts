import axios, { AxiosHeaders } from "axios";
import type { z } from "zod";
import { decodeJson, encodeJson, utf8Size } from "@/services/json";
import { getRegistrySessionToken, registryApiBaseUrl } from "@/services/registry";
import { transactionSchema, type Transaction } from "@/types/domain";

let selectedDeviceId = "";
let unauthorized: () => void = () => {};
export function onUnauthorized(callback: () => void): void { unauthorized = callback; }

export function setApiDevice(deviceId: string): void {
  const value = deviceId.trim();
  if (!value) {
    selectedDeviceId = "";
    api.defaults.baseURL = registryApiBaseUrl;
    return;
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("Select a valid saved firewall");
  }
  selectedDeviceId = value;
  api.defaults.baseURL = `${registryApiBaseUrl}/devices/${encodeURIComponent(value)}/proxy`;
}

export class ApiFailure extends Error {
  constructor(
    message: string,
    public status?: number,
    public transaction?: Transaction,
    public uncertain = false,
    public incompatible = false,
  ) { super(message); this.name = "ApiFailure"; }
}

const api = axios.create({
  baseURL: registryApiBaseUrl,
  timeout: 80_000,
  adapter: "fetch",
  fetchOptions: { redirect: "error", credentials: "omit", cache: "no-store" },
  transformResponse: [(data: unknown) => data],
  headers: { Accept: "application/json" },
});
api.interceptors.request.use((request) => {
  const token = getRegistrySessionToken();
  if (!token) throw new ApiFailure("Sign in to the device registry first", 401);
  if (!selectedDeviceId) throw new ApiFailure("Select a saved firewall first", 400);
  request.headers.Authorization = `Bearer ${token}`;
  return request;
});

function diagnostic(text: string, credential = getRegistrySessionToken()): string {
  return [...text.replace(/<[^>]*>/g, " ")].map(char => char.charCodeAt(0) < 32 ? " " : char)
    .join("").split(credential || "\u0000").join("[redacted]").slice(0, 4096);
}

export async function request<T>(
  method: "GET" | "POST",
  path: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const writing = method === "POST";
  const requestCredential = getRegistrySessionToken();
  const serialized = body === undefined ? undefined : encodeJson(body);
  if (serialized !== undefined && utf8Size(serialized) > 1_048_576) {
    throw new ApiFailure("Complete UTF-8 request exceeds the 1 MiB limit", 422);
  }
  let response;
  try {
    response = await api.request<unknown>({
      method, url: path, data: serialized, signal,
      timeout: writing ? 90_000 : 80_000,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      validateStatus: () => true,
    });
  } catch (error) {
    if (error instanceof ApiFailure) throw error;
    throw new ApiFailure(
      axios.isAxiosError(error) && (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT")
        ? "Request timed out. Server outcome may still be pending."
        : "Connection to the controller failed or redirected. Check that the controller is reachable.",
      undefined, undefined, writing,
    );
  }
  const raw = typeof response.data === "string" ? response.data : "";
  const registryAuthError = response.headers instanceof AxiosHeaders
    ? response.headers.get("X-Registry-Auth-Error")
    : response.headers["x-registry-auth-error"];
  if (response.status === 401 && registryAuthError === "true") unauthorized();
  let data: unknown;
  try { data = decodeJson(raw); }
  catch {
    throw new ApiFailure(`HTTP ${response.status}: non-JSON or incompatible response. ${diagnostic(raw, requestCredential)}`,
      response.status, undefined, writing, response.status < 400);
  }
  if (response.status >= 400) {
    const envelope = data && typeof data === "object" ? data : {};
    const message = "error" in envelope && typeof envelope.error === "string" ? diagnostic(envelope.error, requestCredential) : "Request rejected";
    const transaction = "transaction" in envelope ? transactionSchema.safeParse(envelope.transaction) : undefined;
    const malformedTransaction = "transaction" in envelope && envelope.transaction !== null && !transaction?.success;
    throw new ApiFailure(`HTTP ${response.status}: ${message}${malformedTransaction ? " (incompatible transaction data)" : ""}`, response.status,
      transaction?.success ? transaction.data : undefined,
      writing && (response.status >= 500 || malformedTransaction), malformedTransaction);
  }
  const decoded = schema.safeParse(data);
  if (!decoded.success) {
    const paths = decoded.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new ApiFailure(`Incompatible API response: ${diagnostic(paths, requestCredential)}`, response.status, undefined, writing, true);
  }
  return decoded.data;
}

export default api;
