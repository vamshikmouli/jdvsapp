'use client';

/**
 * Shared React Query defaults + a tiny JSON fetcher.
 *
 * On the CPU-throttled VM, caching and request de-duplication are the cheapest
 * win we have: revisiting a tab or re-rendering no longer re-hits the API, and
 * two components asking for the same key share one in-flight request.
 */
import { QueryClient } from '@tanstack/react-query';

/** GET a JSON endpoint, throwing on non-2xx with the server's error text. */
export async function jsonFetcher<T = any>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      /* non-JSON error body — keep the status message */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

/** One QueryClient per browser session, created lazily in the Providers tree. */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // The data here (rosters, fee config, reports) changes slowly; a short
        // fresh window kills the re-fetch storm without showing stale money.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
}
