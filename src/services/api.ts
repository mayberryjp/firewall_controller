import axios from "axios";
import type { z } from "zod";
import { decodeJson, encodeJson, utf8Size } from "@/services/json";
import { transactionSchema, type Transaction } from "@/types/domain";

let token = "";
let unauthorized: () => void = () => {};
export function setCredential(value: string): void { token = value; }
export function onUnauthorized(callback: () => void): void { unauthorized = callback; }

const base = import.meta.env.VITE_API_BASE_URL || "/api/v1";
const resolved = new URL(base, window.location.origin);
if (resolved.origin !== window.location.origin || resolved.search || resolved.hash) {
  throw new Error("API base must be a trusted same-origin path without query or fragment");
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
  baseURL: resolved.pathname.replace(/\/+$/, ""),
  timeout: 80_000,
  adapter: "fetch",
  fetchOptions: { redirect: "error", credentials: "omit", cache: "no-store" },
  transformResponse: [(data: unknown) => data],
  headers: { Accept: "application/json" },
});
api.interceptors.request.use((request) => {
  if (!token) throw new ApiFailure("Enter a bearer credential to connect", 401);
  request.headers.Authorization = `Bearer ${token}`;
  return request;
});

function diagnostic(text: string, credential = token): string {
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
  const requestCredential = token;
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
        : "Connection failed or API redirected. Check the trusted same-origin deployment.",
      undefined, undefined, writing,
    );
  }
  const raw = typeof response.data === "string" ? response.data : "";
  if (response.status === 401) unauthorized();
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
