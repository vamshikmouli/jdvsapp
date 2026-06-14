import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { getActiveYear, getStudentAccount } from '@/lib/services/fees';

export async function GET(req: NextRequest, { params }: { params: { studentId: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'FEES_VIEW')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const { searchParams } = new URL(req.url);
    const yearId = searchParams.get('year') || (await getActiveYear()).id;

    const account = await getStudentAccount(params.studentId, yearId);
    if (!account) return NextResponse.json({ error: 'Student not found' }, { status: 404 });
    return NextResponse.json(account);
  } catch (err) {
    console.error('fees/accounts/[id] GET', err);
    return NextResponse.json({ error: 'Failed to load account' }, { status: 500 });
  }
}
