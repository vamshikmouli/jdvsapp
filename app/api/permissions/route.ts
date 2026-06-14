import { NextResponse } from 'next/server';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';
import { PERMISSION_CATALOG } from '@/lib/rbac/permissions';

// GET /api/permissions — the grouped permission catalog for the role editor
export async function GET() {
  try {
    await requirePermission('ROLES_MANAGE');
    return NextResponse.json(PERMISSION_CATALOG);
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
