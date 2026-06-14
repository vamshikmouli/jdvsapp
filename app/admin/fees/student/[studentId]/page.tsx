'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { PageHeader, Button, Card, Skeleton, EmptyState } from '@/components/Primitives';
import { Icon } from '@/components/Icon';
import { AccountView, CollectDrawer, AssignDrawer, shortClass, type Account } from '../../account-ui';

export default function StudentFeePage() {
  const { studentId } = useParams<{ studentId: string }>();
  const { data: session } = useSession();
  const perms = ((session?.user as any)?.perms as string[]) || [];
  const canCollect = perms.includes('FEES_COLLECT');
  const canVoid = perms.includes('FEES_VOID');
  const canNotify = perms.includes('NOTICES_MANAGE');

  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    const res = await fetch(`/api/fees/accounts/${studentId}`);
    if (res.ok) setAccount(await res.json());
    else setFailed(true);
    setLoading(false);
  }, [studentId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div className="max-w-2xl mx-auto mt-6 space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={48} />)}</div>;
  }
  if (failed || !account) {
    return <div className="mt-12"><EmptyState icon="FileX" title="Fee account not found" body="This student may not have a fee assignment yet." /></div>;
  }

  const s = account.summary;

  return (
    <div className="max-w-2xl mx-auto">
      <a href="/admin/fees" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-3">
        <Icon name="ArrowLeft" size={16} /> All fee accounts
      </a>

      <PageHeader
        eyebrow="Fee account"
        title={account.student.name}
        meta={`${account.student.id} · ${shortClass(account.student.className)}${account.student.section ? ' ' + account.student.section : ''} · Balance ${money(s.totalBalance)}`}
        actions={
          canCollect ? (
            <>
              <Button icon="SlidersHorizontal" onClick={() => setEditing(true)}>Edit plan</Button>
              {s.totalBalance > 0 && (
                <Button kind="primary" icon="IndianRupee" onClick={() => setCollecting(true)}>Collect payment</Button>
              )}
            </>
          ) : undefined
        }
      />

      <Card className="mt-4">
        <AccountView account={account} canRequestConcession={canCollect} canVoid={canVoid} canNotify={canNotify} onChanged={load} />
      </Card>

      {collecting && (
        <CollectDrawer account={account} onClose={() => setCollecting(false)} onDone={async () => { setCollecting(false); await load(); }} />
      )}
      {editing && (
        <AssignDrawer studentId={studentId} onClose={() => setEditing(false)} onDone={async () => { setEditing(false); await load(); }} />
      )}
    </div>
  );
}

function money(n: number) {
  return '₹' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(n || 0));
}
