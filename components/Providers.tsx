'use client';

import { SessionProvider } from 'next-auth/react';
import { PinGate } from '@/components/PinGate';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      {children}
      <PinGate />
    </SessionProvider>
  );
}
