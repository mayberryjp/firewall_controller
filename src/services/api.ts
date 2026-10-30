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

function diagnostic(text: string, credential = getRegistrySessionToken(), bounded = true): string {
  const sanitized = [...text.replace(/<[^>]*>/g, " ")].map(char => char.charCodeAt(0) < 32 ? " " : char)
    .join("").split(credential || "\u0000").join("[redacted]");
  return bounded ? sanitized.slice(0, 4096) : sanitized;
}

// Drops keys this client doesn't know from a response (a newer backend) rather than rejecting it.
function tolerantParse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, data: unknown): z.SafeParseReturnType<unknown, T> {
  let result = schema.safeParse(data);
  for (let attempt = 0; attempt < 3 && !result.success; attempt++) {
    let removed = false;
    const visit = (issues: z.ZodIssue[]): void => {
      for (const issue of issues) {
        if (issue.code === "unrecognized_keys") {
          let target: unknown = data;
          for (const step of issue.path) target = target && typeof target === "object" ? (target as Record<string | number, unknown>)[step] : undefined;
          if (target && typeof target === "object") for (const key of issue.keys) { delete (target as Record<string, unknown>)[key]; removed = true; }
        } else if (issue.code === "invalid_union") issue.unionErrors.forEach(error => visit(error.issues));
      }
    };
    visit(result.error.issues);
    if (!removed) break;
    result = schema.safeParse(data);
  }
  return result;
}

export async function request<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const writing = method !== "GET";
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
  catch (error) {
    const reason = error instanceof Error ? diagnostic(error.message, requestCredential) : "Unable to decode response";
    throw new ApiFailure(`HTTP ${response.status}: non-JSON or incompatible response. ${reason}`,
      response.status, undefined, writing, response.status < 400);
  }
  if (response.status >= 400) {
    const envelope = data && typeof data === "object" ? data : {};
    const message = "error" in envelope && typeof envelope.error === "string" ? diagnostic(envelope.error, requestCredential, false) : "Request rejected";
    const transaction = "transaction" in envelope ? tolerantParse(transactionSchema, envelope.transaction) : undefined;
    const malformedTransaction = "transaction" in envelope && envelope.transaction !== null && !transaction?.success;
    if (transaction?.success && transaction.data.error) transaction.data.error = diagnostic(transaction.data.error, requestCredential, false);
    throw new ApiFailure(`HTTP ${response.status}: ${message}${malformedTransaction ? " (incompatible transaction data)" : ""}`, response.status,
      transaction?.success ? transaction.data : undefined,
      writing && (response.status >= 500 || malformedTransaction), malformedTransaction);
  }
  const decoded = tolerantParse(schema, data);
  if (!decoded.success) {
    const paths = decoded.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new ApiFailure(`Incompatible API response: ${diagnostic(paths, requestCredential)}`, response.status, undefined, writing, true);
  }
  return decoded.data;
}

export async function inspectApiPath(input: string, signal?: AbortSignal): Promise<{ status: number; body: string }> {
  const path = input.trim();
  const pathname = path.split("?")[0]!;
  if (!/^\/api\/v1\/[A-Za-z0-9_~:@/.-]+$/.test(pathname) ||
      pathname.slice(8).split("/").some(segment => !segment || segment === "." || segment === "..") ||
      /[\s\\#]/.test(path) ||
      [...path].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
    throw new ApiFailure("Enter an appliance path beginning with /api/v1/ without URLs, fragments or traversal segments.");
  }
  try {
    const response = await api.request<string>({
      method: "GET", url: path.slice(7), signal, responseType: "text", validateStatus: () => true,
    });
    const registryAuthError = response.headers instanceof AxiosHeaders
      ? response.headers.get("X-Registry-Auth-Error")
      : response.headers["x-registry-auth-error"];
    if (response.status === 401 && registryAuthError === "true") unauthorized();
    return { status: response.status, body: String(response.data ?? "") };
  } catch (error) {
    if (error instanceof ApiFailure) throw error;
    if (signal?.aborted) throw new ApiFailure("Request cancelled.");
    throw new ApiFailure("Unable to read the appliance response. Check connectivity and try again.");
  }
}

export default api;
