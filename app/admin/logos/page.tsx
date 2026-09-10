'use client';

import React from 'react';
import { useSession } from 'next-auth/react';
import { Card, EmptyState } from '@/components/Primitives';
import { BrandAssets } from '@/components/BrandAssets';

// Admin-only: view/download the school's official logo files.
export default function LogosPage() {
  const { data: session } = useSession();
  const perms = ((session?.user as any)?.perms as string[]) || [];
  const isAdmin = perms.includes('SETTINGS_MANAGE');

  if (!isAdmin) {
    return (
      <div className="p-4 sm:p-6 max-w-5xl mx-auto">
        <EmptyState icon="Lock" title="Admins only" body="The school logo downloads are available to administrators only." />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
      <div>
        <h1 className="text-lg sm:text-xl font-semibold text-slate-900">School logos</h1>
        <p className="text-sm text-slate-500">Download the official school logo files in their original formats.</p>
      </div>
      <Card>
        <BrandAssets />
      </Card>
    </div>
  );
}
