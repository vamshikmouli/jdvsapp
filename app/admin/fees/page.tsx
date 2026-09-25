'use client';

import { toast } from '@/lib/toast';
import { useState } from 'react';
import { PageHeader, Button } from '@/components/Primitives';
import { Icon } from '@/components/Icon';
import { usePermissions } from '@/lib/hooks/usePermissions';
import type { Permission } from '@prisma/client';
import { ConcessionsTab } from './concessions-tab';
import { CounterTab } from './counter-tab';
import { CollectionTab, FeeImportDrawer } from './collection-tab';
import { SetupTab } from './setup-tab';
import { ReportsTab } from './reports-tab';

type Tab = 'collection' | 'counter' | 'concessions' | 'setup' | 'reports';

// `perm` may be a single key or "any of" a list. Setup & Reports are hidden by
// default (e.g. from accountants) and grantable in Roles & Access; the
// SETTINGS_MANAGE fallback keeps admins seeing them with no data migration.
const TABS: { id: Tab; label: string; icon: string; perm?: Permission | Permission[] }[] = [
  { id: 'collection', label: 'Collection', icon: 'IndianRupee' },
  { id: 'counter', label: 'Counter billing', icon: 'ShoppingCart' },
  { id: 'concessions', label: 'Concessions', icon: 'BadgePercent', perm: 'FEES_CONCESSION_APPROVE' },
  { id: 'setup', label: 'Fee setup', icon: 'SlidersHorizontal', perm: ['FEES_SETUP', 'SETTINGS_MANAGE'] },
  { id: 'reports', label: 'Reports', icon: 'BarChart3', perm: ['FEES_REPORTS', 'SETTINGS_MANAGE'] },
];

export default function FeesPage() {
  const { can } = usePermissions();
  const canCollect = can('FEES_COLLECT');
  const canManage = can('SETTINGS_MANAGE');
  const canVoid = can('FEES_VOID');
  const canNotify = can('NOTICES_MANAGE');
  const canExport = can('REPORTS_EXPORT') || can('SETTINGS_MANAGE');

  const [tab, setTab] = useState<Tab>('collection');
  const [exporting, setExporting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [feeRefreshKey, setFeeRefreshKey] = useState(0);
  const doExport = async () => {
    setExporting(true);
    try {
      const res = await fetch('/api/fees/export');
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `fees-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Export failed'); } finally { setExporting(false); }
  };

  return (
    <>
      <PageHeader
        eyebrow="Fees"
        title="Fee management"
        meta="Collect fees, configure fee structure, and track balances."
        actions={(canManage || canExport) ? (
          <>
            {canManage && <Button icon="Upload" onClick={() => setImportOpen(true)}>Bulk import (Excel)</Button>}
            {canExport && <Button icon="Download" onClick={doExport} disabled={exporting}>{exporting ? 'Exporting…' : 'Export'}</Button>}
          </>
        ) : undefined}
      />

      <div className="flex flex-nowrap items-center gap-1 mt-6 border-b border-slate-200 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.filter((t) => !t.perm || (Array.isArray(t.perm) ? t.perm.some((p) => can(p)) : can(t.perm))).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-1.5 px-3 sm:px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap flex-shrink-0 transition-colors ${
              tab === t.id ? 'border-purple-500 text-purple-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Icon name={t.icon as any} size={16} className="flex-shrink-0" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'collection' && <CollectionTab refreshKey={feeRefreshKey} canCollect={canCollect} canVoid={canVoid} canNotify={canNotify} canManage={canManage} />}
      {tab === 'counter' && <CounterTab />}
      {tab === 'concessions' && <ConcessionsTab />}
      {tab === 'setup' && <SetupTab canManage={canManage} />}
      {tab === 'reports' && <ReportsTab />}

      {importOpen && <FeeImportDrawer onClose={() => setImportOpen(false)} onDone={() => { setImportOpen(false); setFeeRefreshKey((k) => k + 1); }} />}
    </>
  );
}
