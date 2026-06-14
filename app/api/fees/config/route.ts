import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { can } from '@/lib/rbac/roles';
import { prisma } from '@/lib/db';
import {
  getActiveYear,
  getFeeConfig,
  createFeeType,
  updateFeeType,
  reorderFeeTypes,
  deleteFeeType,
} from '@/lib/services/fees';
import { FeeBillingMode } from '@prisma/client';

export async function GET(_req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'FEES_VIEW')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const year = await getActiveYear();
    const config = await getFeeConfig(year.id);
    return NextResponse.json({ year: { id: year.id, label: year.label }, ...config });
  } catch (err) {
    console.error('fees/config GET', err);
    return NextResponse.json({ error: 'Failed to load fee config' }, { status: 500 });
  }
}

/**
 * PATCH — update a single config value. Body is one of:
 *  { kind: 'classFee', id, amount }
 *  { kind: 'vanFee', id, monthlyFee?, annualFee? }
 *  { kind: 'uniformItem', id, price?, active?, name? }
 */
export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'SETTINGS_MANAGE')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const body = await req.json();
    const { kind, id } = body || {};
    if (!kind || !id) return NextResponse.json({ error: 'kind and id are required' }, { status: 400 });

    if (kind === 'classFee') {
      await prisma.classFee.update({ where: { id }, data: { amount: Math.max(0, Math.round(Number(body.amount) || 0)) } });
    } else if (kind === 'vanFee') {
      const data: any = {};
      if (body.monthlyFee != null) data.monthlyFee = Math.max(0, Math.round(Number(body.monthlyFee)));
      if (body.annualFee != null) data.annualFee = Math.max(0, Math.round(Number(body.annualFee)));
      await prisma.vanFee.update({ where: { id }, data });
    } else if (kind === 'uniformItem') {
      const data: any = {};
      if (body.price != null) data.price = Math.max(0, Math.round(Number(body.price)));
      if (body.active != null) data.active = !!body.active;
      if (body.name != null) data.name = String(body.name);
      await prisma.uniformItem.update({ where: { id }, data });
    } else if (kind === 'feeType') {
      await updateFeeType(id, {
        name: body.name,
        active: body.active,
        installmentable: body.installmentable,
        autoAssign: body.autoAssign,
      });
    } else {
      return NextResponse.json({ error: 'Unknown kind' }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('fees/config PATCH', err);
    return NextResponse.json({ error: 'Failed to update' }, { status: 400 });
  }
}

// Create a fee type, or reorder the list.
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'SETTINGS_MANAGE')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const body = await req.json();

    if (body.action === 'reorderFeeTypes' && Array.isArray(body.order)) {
      await reorderFeeTypes(body.order);
      return NextResponse.json({ ok: true });
    }

    const validModes = Object.values(FeeBillingMode);
    if (!body.name || !validModes.includes(body.billingMode)) {
      return NextResponse.json({ error: 'name and a valid billingMode are required' }, { status: 400 });
    }
    const feeType = await createFeeType({
      name: body.name,
      billingMode: body.billingMode,
      installmentable: !!body.installmentable,
      autoAssign: body.autoAssign,
    });
    return NextResponse.json(feeType, { status: 201 });
  } catch (err) {
    console.error('fees/config POST', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to create' }, { status: 400 });
  }
}

// Delete a fee type (only if unused).
export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !can(session, 'SETTINGS_MANAGE')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    await deleteFeeType(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('fees/config DELETE', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to delete' }, { status: 400 });
  }
}
