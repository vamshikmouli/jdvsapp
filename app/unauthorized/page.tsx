'use client';

import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Button, Card } from '@/components/Primitives';
import { Icon } from '@/components/Icon';

export default function UnauthorizedPage() {
  const router = useRouter();
  const { data: session } = useSession();

  const surfaceLabel: Record<string, string> = {
    ADMIN: 'Administrator',
    TEACHER: 'Teacher',
    ACCOUNTANT: 'Accountant',
    PARENT: 'Parent',
  };

  const surface = (session?.user as any)?.surface || 'PARENT';
  const displayRole = (session?.user as any)?.roleName || surfaceLabel[surface];

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-slate-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md text-center">
        <div className="mb-6">
          <div className="inline-block mb-4 p-3 bg-danger-50 rounded-full">
            <Icon name="Lock" size={32} className="text-danger-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mt-4">Access Denied</h1>
          <p className="text-sm text-slate-500 mt-2">
            You don't have permission to access this page.
          </p>
        </div>

        <div className="bg-slate-50 rounded-lg p-4 mb-6 text-left">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">Your Role</div>
          <div className="text-sm font-medium text-slate-900 mt-1">{displayRole}</div>
        </div>

        <p className="text-xs text-slate-500 mb-6">
          If you believe this is a mistake, contact your school administrator.
        </p>

        <div className="flex gap-2">
          <Button className="flex-1" onClick={() => router.back()}>
            Go back
          </Button>
          <Button
            kind="primary"
            className="flex-1"
            onClick={() => router.push(surface === 'PARENT' ? '/parent' : '/admin/dashboard')}
          >
            Go to dashboard
          </Button>
        </div>
      </Card>
    </div>
  );
}
