'use client';

import React, { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';

interface Asset {
  name: string;
  label: string;
  mime: string;
  size: number | null;
  url: string;
  downloadUrl: string;
}

function fmtSize(bytes: number | null): string {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function iconFor(mime: string): string {
  if (mime.startsWith('image/')) return 'Image';
  if (mime === 'application/pdf') return 'FileText';
  return 'File';
}

/**
 * School logo / brand asset downloads. Fetches the public `brand/` folder and
 * lets anyone (parent, staff, admin) download each file in its original format.
 * Self-contained so it can be dropped into either the admin shell or the
 * parent surface.
 */
export function BrandAssets({ compact = false }: { compact?: boolean }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    fetch('/api/brand-assets')
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        setAssets(j.assets || []);
        if (!j.assets?.length) setError(j.configured === false ? 'Storage not configured on this environment.' : 'No files available yet.');
      })
      .catch(() => alive && setError('Could not load downloads.'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  if (loading) {
    return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-14 rounded-lg bg-slate-100 animate-pulse" />)}</div>;
  }
  if (!assets.length) {
    return <div className="text-sm text-slate-500 py-2">{error || 'No files available.'}</div>;
  }

  return (
    <div className={compact ? 'space-y-2' : 'grid gap-2 sm:grid-cols-2'}>
      {assets.map((a) => {
        const isImg = a.mime.startsWith('image/');
        return (
          <div key={a.name} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-2.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100">
              {isImg
                ? <img src={a.url} alt="" className="h-full w-full object-contain" />
                : <Icon name={iconFor(a.mime) as React.ComponentProps<typeof Icon>['name']} size={20} className="text-slate-500" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-slate-900">{a.label}</div>
              <div className="text-xs text-slate-400">{a.name}{a.size != null ? ` · ${fmtSize(a.size)}` : ''}</div>
            </div>
            <a
              href={a.downloadUrl}
              download={a.name}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-purple-600 px-3 py-2 text-xs font-semibold text-white hover:bg-purple-700"
            >
              <Icon name="Download" size={15} /> Download
            </a>
          </div>
        );
      })}
    </div>
  );
}
