import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { decideConcession, deleteConcession } from '@/lib/services/fees';

// Approve / reject a concession (admins with FEES_CONCESSION_APPROVE).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'FEES_CONCESSION_APPROVE')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const body = await req.json();
    const action = body?.action;
    if (action !== 'approve' && action !== 'reject') {
      return NextResponse.json({ error: 'action must be approve or reject' }, { status: 400 });
    }
    const result = await decideConcession(params.id, action === 'approve', (session.user as any)?.id || null, body.note || null);
    return NextResponse.json(result);
  } catch (err) {
    console.error('fees/concessions/[id] PATCH', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to decide' }, { status: 400 });
  }
}

// Cancel a pending concession request (FEES_COLLECT or an approver).
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !(can(session, 'FEES_COLLECT') || can(session, 'FEES_CONCESSION_APPROVE'))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    await deleteConcession(params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('fees/concessions/[id] DELETE', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to delete' }, { status: 400 });
  }
}
