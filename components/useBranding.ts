'use client';

import { useEffect, useState } from 'react';

export interface Branding {
  schoolName: string;
  logoUrl: string | null;
}

const FALLBACK: Branding = { schoolName: 'Jnana Deepika', logoUrl: null };

// Module-level cache so the public /api/branding is fetched once per page load,
// not once per component that needs the logo.
let cache: Branding | null = null;
let inflight: Promise<Branding> | null = null;

function load(): Promise<Branding> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = fetch('/api/branding')
      .then((r) => r.json())
      .then((d) => {
        cache = { schoolName: d?.schoolName || FALLBACK.schoolName, logoUrl: d?.logoUrl || null };
        return cache;
      })
      .catch(() => FALLBACK);
  }
  return inflight;
}

/** School name + logo for headers/sidebars. Reads the public branding endpoint. */
export function useBranding(): Branding {
  const [branding, setBranding] = useState<Branding>(cache || FALLBACK);
  useEffect(() => {
    let alive = true;
    load().then((b) => { if (alive) setBranding(b); });
    return () => { alive = false; };
  }, []);
  return branding;
}
