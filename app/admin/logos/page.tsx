'use client';

import React from 'react';
import { Card } from '@/components/Primitives';
import { BrandAssets } from '@/components/BrandAssets';

// Any signed-in staff member can view/download the school's logo files.
export default function LogosPage() {
  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">School logos</h1>
        <p className="text-sm text-slate-500">Download the official school logo files in their original formats.</p>
      </div>
      <Card>
        <BrandAssets />
      </Card>
    </div>
  );
}
