// Fetch wrapper. Access token in memory. Refresh token: httpOnly cookie on the web,
// OS keychain (via the preload bridge) in the desktop app.

import { desktop } from "./desktop";

const BASE = `${desktop?.apiBase ?? ""}/api/v1`;
let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function setAccessToken(token: string | null) {
  accessToken = token;
}

async function doRefresh(): Promise<boolean> {
  if (desktop) {
    const refresh = await desktop.getRefresh();
    if (!refresh) return false;
    const r = await fetch(`${BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh }),
    });
    if (!r.ok) {
      if (r.status === 401) await desktop.setRefresh(null);
      return false;
    }
    const data = await r.json();
    accessToken = data.access;
    await desktop.setRefresh(data.refresh);
    return true;
  }
  const r = await fetch(`${BASE}/auth/refresh`, { method: "POST", credentials: "same-origin" });
  if (!r.ok) return false;
  accessToken = (await r.json()).access;
  return true;
}

export function refreshAccess(): Promise<boolean> {
  if (!refreshing) {
    refreshing = doRefresh()
      .catch(() => false)
      .finally(() => setTimeout(() => (refreshing = null), 0));
  }
  return refreshing;
}

type Options = Omit<RequestInit, "body"> & { body?: unknown };

export async function api<T = any>(path: string, opts: Options = {}, retried = false): Promise<T> {
  const headers = new Headers(opts.headers);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...opts, headers, body, credentials: desktop ? "omit" : "same-origin" });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection.");
  }
  if (res.status === 401 && !retried && !path.startsWith("/auth/login")) {
    if (await refreshAccess()) return api<T>(path, opts, true);
  }
  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: `Unexpected response (${res.status})` };
  }
  if (!res.ok) throw new ApiError(res.status, data.message || `Request failed (${res.status})`);
  return data as T;
}

export const get = <T = any>(path: string) => api<T>(path);
export const post = <T = any>(path: string, body?: unknown) => api<T>(path, { method: "POST", body });
export const patch = <T = any>(path: string, body?: unknown) => api<T>(path, { method: "PATCH", body });
export const put = <T = any>(path: string, body?: unknown) => api<T>(path, { method: "PUT", body });
export const del = <T = any>(path: string) => api<T>(path, { method: "DELETE" });

export function qs(params: Record<string, string | number | undefined | null>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
}
