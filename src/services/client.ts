// ApiClient facade with a pluggable transport (ADR-002 §4.2).
//
// Production transport: `invoke("http_request")` — all traffic goes through
// Rust reqwest, so the WebView never makes cross-origin requests and the mock
// server needs no CORS.
// Dev-only transport: `fetch` — active when VITE_TRANSPORT=fetch, used by
// Playwright E2E and plain-browser development.
//
// Callers are unaware of the transport; the global `?directory=` parameter is
// injected here from the active project directory.

import { invoke } from "@tauri-apps/api/core";
import { ApiError } from "./errors.js";
import type { paths } from "./api/schema.js";
import { getActiveDirectory } from "../stores/project.js";

export type ApiPath = keyof paths;
export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface AuthCredentials {
  username?: string;
  password?: string;
}

export interface RequestOptions {
  serverID?: string;
  query?: Record<string, string | number | boolean>;
  body?: unknown;
  auth?: AuthCredentials;
  timeoutMs?: number;
  requestID?: string;
}

export interface TransportRequest {
  serverID?: string;
  url?: string;
  method: string;
  path: string;
  query?: Record<string, string | number | boolean>;
  body?: unknown;
  auth?: AuthCredentials;
  timeoutMs?: number;
  requestID?: string;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body?: unknown;
  bodyText?: string;
}

export interface Transport {
  request(input: TransportRequest): Promise<HttpResponse>;
}

export interface ApiClientOptions {
  getDirectory?: () => string | undefined;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const FETCH_BASE_URL = import.meta.env.VITE_MOCK_BASE_URL ?? "http://localhost:14096";

/** Production transport: Tauri invoke of the Rust `http_request` command. */
export const invokeTransport: Transport = {
  request: (input) => invoke<HttpResponse>("http_request", { request: input }),
};

function basicAuthHeader(username: string | undefined, password: string): string {
  return `Basic ${btoa(`${username ?? ""}:${password}`)}`;
}

function buildUrl(input: TransportRequest): string {
  const base = `${(input.url ?? FETCH_BASE_URL).replace(/\/+$/, "")}/`;
  const url = new URL(input.path.replace(/^\//, ""), base);
  if (input.query) {
    for (const [key, value] of Object.entries(input.query)) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function mapFetchError(err: unknown): ApiError {
  // DOMException (AbortSignal.timeout) is not an Error instance in jsdom,
  // so the name is read structurally.
  const name =
    typeof err === "object" && err !== null ? (err as { name?: unknown }).name : undefined;
  if (name === "TimeoutError") return new ApiError(undefined, "timeout", messageOf(err), true);
  if (name === "AbortError") return new ApiError(undefined, "cancelled", messageOf(err), false);
  return new ApiError(undefined, "network", messageOf(err), true);
}

/** Dev-only transport: plain fetch (needs the mock server to run with CORS). */
export const fetchTransport: Transport = {
  async request(input) {
    const url = buildUrl(input);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (input.auth?.password) {
      headers.Authorization = basicAuthHeader(input.auth.username, input.auth.password);
    }
    if (input.body !== undefined) {
      // Mirrors the Rust transport (`reqwest::RequestBuilder::json`), which
      // sets Content-Type: application/json for JSON bodies.
      headers["Content-Type"] = "application/json";
    }
    let response: Response;
    try {
      response = await fetch(url, {
        method: input.method,
        headers,
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
        signal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (err) {
      throw mapFetchError(err);
    }
    const bodyText = await response.text();
    let body: unknown;
    try {
      body = bodyText ? JSON.parse(bodyText) : undefined;
    } catch {
      body = undefined;
    }
    if (!response.ok) {
      throw new ApiError(response.status, "http", bodyText.slice(0, 200), response.status >= 500);
    }
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
      bodyText: bodyText || undefined,
    };
  },
};

export class ApiClient {
  constructor(
    private readonly transport: Transport,
    private readonly options: ApiClientOptions = {},
  ) {}

  request(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<HttpResponse> {
    return this.transport
      .request(this.buildRequest(method, path, options))
      .catch((err: unknown) => {
        throw ApiError.fromUnknown(err);
      });
  }

  get<T = unknown>(path: ApiPath, options?: RequestOptions): Promise<T> {
    return this.request("GET", path, options).then((response) => response.body as T);
  }

  post<T = unknown>(path: ApiPath, options?: RequestOptions): Promise<T> {
    return this.request("POST", path, options).then((response) => response.body as T);
  }

  patch<T = unknown>(path: ApiPath, options?: RequestOptions): Promise<T> {
    return this.request("PATCH", path, options).then((response) => response.body as T);
  }

  put<T = unknown>(path: ApiPath, options?: RequestOptions): Promise<T> {
    return this.request("PUT", path, options).then((response) => response.body as T);
  }

  delete<T = unknown>(path: ApiPath, options?: RequestOptions): Promise<T> {
    return this.request("DELETE", path, options).then((response) => response.body as T);
  }

  private buildRequest(
    method: HttpMethod,
    path: string,
    options: RequestOptions,
  ): TransportRequest {
    const query = { ...options.query };
    // An explicit per-call directory wins over the global context; the
    // global value only fills in for callers without one (TASK-M2-03).
    const directory = this.options.getDirectory?.();
    if (directory !== undefined && query.directory === undefined) {
      query.directory = directory;
    }
    const request: TransportRequest = { method, path };
    if (options.serverID) request.serverID = options.serverID;
    if (Object.keys(query).length > 0) request.query = query;
    if (options.body !== undefined) request.body = options.body;
    if (options.auth) request.auth = options.auth;
    if (options.timeoutMs !== undefined) request.timeoutMs = options.timeoutMs;
    if (options.requestID) request.requestID = options.requestID;
    return request;
  }
}

function defaultTransport(): Transport {
  return import.meta.env.VITE_TRANSPORT === "fetch" ? fetchTransport : invokeTransport;
}

let apiClient: ApiClient | undefined;

/**
 * Singleton client. The global `?directory=` injection reads the active
 * server's current project directory from the project store (TASK-M2-03).
 */
export function getApiClient(): ApiClient {
  apiClient ??= new ApiClient(defaultTransport(), { getDirectory: getActiveDirectory });
  return apiClient;
}
