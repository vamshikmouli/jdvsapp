import { API_URL } from '@/config';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// Set by the AuthProvider so every request carries the current Bearer token,
// and so a 401 can drop the user back to login.
let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

interface Options {
  method?: 'GET' | 'POST';
  body?: unknown;
  auth?: boolean; // attach Bearer token (default true)
}

export async function api<T = any>(path: string, opts: Options = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = opts;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth && authToken) headers.Authorization = `Bearer ${authToken}`;

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && auth) {
    onUnauthorized?.();
    throw new ApiError('Session expired. Please sign in again.', 401);
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(json?.error || 'Something went wrong.', res.status);
  return json as T;
}
