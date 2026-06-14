import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';
import { ALL_PERMISSIONS } from '@/lib/rbac/permissions';
import { Permission, Surface } from '@prisma/client';

// GET /api/roles — list all roles with permissions + user counts
export async function GET() {
  try {
    await requirePermission('ROLES_MANAGE');
    const roles = await prisma.role.findMany({
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      include: {
        permissions: { select: { permission: true } },
        _count: { select: { users: true } },
      },
    });
    return NextResponse.json(
      roles.map((r) => ({
        id: r.id,
        key: r.key,
        name: r.name,
        description: r.description,
        isSystem: r.isSystem,
        isActive: r.isActive,
        baseSurface: r.baseSurface,
        permissions: r.permissions.map((p) => p.permission),
        userCount: r._count.users,
      }))
    );
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// POST /api/roles — create a custom role
export async function POST(req: NextRequest) {
  try {
    await requirePermission('ROLES_MANAGE');
    const body = await req.json();
    const name = (body.name || '').trim();
    const description = (body.description || '').trim() || null;
    const baseSurface = body.baseSurface as Surface;
    const permissions = (body.permissions || []) as Permission[];

    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    if (!['ADMIN', 'TEACHER', 'ACCOUNTANT', 'PARENT'].includes(baseSurface)) {
      return NextResponse.json({ error: 'Invalid base surface' }, { status: 400 });
    }
    const validPerms = permissions.filter((p) => ALL_PERMISSIONS.includes(p));

    // Ensure a unique key
    let key = slugify(name);
    if (!key) return NextResponse.json({ error: 'Invalid name' }, { status: 400 });
    const existing = await prisma.role.findUnique({ where: { key } });
    if (existing) key = `${key}_${Date.now().toString(36)}`;

    const role = await prisma.role.create({
      data: {
        key,
        name,
        description,
        baseSurface,
        isSystem: false,
        permissions: { create: validPerms.map((p) => ({ permission: p })) },
      },
      include: { permissions: true, _count: { select: { users: true } } },
    });

    return NextResponse.json({
      id: role.id,
      key: role.key,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      isActive: role.isActive,
      baseSurface: role.baseSurface,
      permissions: role.permissions.map((p) => p.permission),
      userCount: 0,
    });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
