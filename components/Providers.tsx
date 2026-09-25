'use client';

import { useState } from 'react';
import { SessionProvider } from 'next-auth/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { PinGate } from '@/components/PinGate';
import { Toaster } from '@/components/Toaster';
import { makeQueryClient } from '@/lib/query';

export function Providers({ children }: { children: React.ReactNode }) {
  // One client per mount (kept out of module scope so it isn't shared between
  // users during SSR).
  const [queryClient] = useState(makeQueryClient);
  return (
    <SessionProvider>
      <QueryClientProvider client={queryClient}>
        {children}
        <PinGate />
        <Toaster />
      </QueryClientProvider>
    </SessionProvider>
  );
}
