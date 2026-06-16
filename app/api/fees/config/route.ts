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
  autoAssignClassFees,
} from '@/lib/services/fees';
import { FeeBillingMode } from '@prisma/client';
import { VILLAGE_VAN_FEES, UNIFORM_ITEMS } from '@/lib/feeStructure';
import { buildDefaultMatrix } from '@/lib/uniformMatrix';

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
      if (body.village != null) data.village = String(body.village).trim();
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

    // Assign the auto-applied class fees to all active students (for students
    // added before fees were configured). Idempotent — skips heads already charged.
    if (body.action === 'assignAllClassFees') {
      const year = await getActiveYear();
      const students = await prisma.student.findMany({
        where: { status: 'ACTIVE', classId: { not: null } },
        select: { id: true, classId: true },
      });
      let assigned = 0;
      for (const s of students) {
        try { await autoAssignClassFees(s.id, s.classId!, year.id); assigned++; } catch (e) { console.error('assign failed', s.id, e); }
      }
      return NextResponse.json({ ok: true, assigned, total: students.length });
    }

    // Save the uniform price matrix (class × gender) for the active year.
    if (body.action === 'setUniformMatrix') {
      const year = await getActiveYear();
      await prisma.academicYear.update({ where: { id: year.id }, data: { uniformPrices: body.matrix ?? {} } });
      return NextResponse.json({ ok: true });
    }

    // Seed the uniform matrix from the school's standard file values, and ensure
    // the catalogue rows exist (uniform selections reference them by name).
    if (body.action === 'seedUniformMatrix') {
      const year = await getActiveYear();
      const classes = await prisma.schoolClass.findMany({ select: { id: true } });
      const matrix = buildDefaultMatrix(classes.map((c) => c.id));
      await prisma.academicYear.update({ where: { id: year.id }, data: { uniformPrices: matrix } });

      const existing = new Set((await prisma.uniformItem.findMany({ where: { yearId: year.id }, select: { name: true } })).map((u) => u.name));
      let order = await prisma.uniformItem.count({ where: { yearId: year.id } });
      for (const it of UNIFORM_ITEMS) {
        if (existing.has(it.name)) continue;
        await prisma.uniformItem.create({ data: { yearId: year.id, name: it.name, price: 0, order: order++ } });
      }
      return NextResponse.json({ ok: true });
    }

    // Load the school's standard village van fees from feeStructure.ts into the
    // DB for the active year (skips villages that already exist).
    if (body.action === 'seedVanDefaults') {
      const year = await getActiveYear();
      const existing = new Set((await prisma.vanFee.findMany({ where: { yearId: year.id }, select: { village: true } })).map((v) => v.village));
      let added = 0;
      for (const v of VILLAGE_VAN_FEES) {
        const village = v.village.trim();
        if (existing.has(village)) continue;
        await prisma.vanFee.create({ data: { yearId: year.id, village, annualFee: v.fee, monthlyFee: Math.round(v.fee / 12) } });
        added++;
      }
      return NextResponse.json({ ok: true, added });
    }

    // Load the school's standard uniform items (names) into the DB for the year.
    if (body.action === 'seedUniformDefaults') {
      const year = await getActiveYear();
      const existing = new Set((await prisma.uniformItem.findMany({ where: { yearId: year.id }, select: { name: true } })).map((u) => u.name));
      let order = await prisma.uniformItem.count({ where: { yearId: year.id } });
      let added = 0;
      for (const it of UNIFORM_ITEMS) {
        const name = it.name.trim();
        if (existing.has(name)) continue;
        await prisma.uniformItem.create({ data: { yearId: year.id, name, price: 0, order: order++ } });
        added++;
      }
      return NextResponse.json({ ok: true, added });
    }

    // Add a village van fee.
    if (body.action === 'addVanFee') {
      const year = await getActiveYear();
      const village = String(body.village || '').trim();
      if (!village) return NextResponse.json({ error: 'Village name is required' }, { status: 400 });
      const exists = await prisma.vanFee.findUnique({ where: { yearId_village: { yearId: year.id, village } } });
      if (exists) return NextResponse.json({ error: `"${village}" already has a van fee` }, { status: 400 });
      const vf = await prisma.vanFee.create({
        data: {
          yearId: year.id, village,
          monthlyFee: Math.max(0, Math.round(Number(body.monthlyFee) || 0)),
          annualFee: Math.max(0, Math.round(Number(body.annualFee) || 0)),
        },
      });
      return NextResponse.json(vf, { status: 201 });
    }

    // Add a uniform catalogue item.
    if (body.action === 'addUniformItem') {
      const year = await getActiveYear();
      const name = String(body.name || '').trim();
      if (!name) return NextResponse.json({ error: 'Item name is required' }, { status: 400 });
      const exists = await prisma.uniformItem.findUnique({ where: { yearId_name: { yearId: year.id, name } } });
      if (exists) return NextResponse.json({ error: `"${name}" already exists` }, { status: 400 });
      const count = await prisma.uniformItem.count({ where: { yearId: year.id } });
      const ui = await prisma.uniformItem.create({
        data: { yearId: year.id, name, price: Math.max(0, Math.round(Number(body.price) || 0)), order: count },
      });
      return NextResponse.json(ui, { status: 201 });
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
    const kind = searchParams.get('kind');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    if (kind === 'vanFee') {
      await prisma.vanFee.delete({ where: { id } });
    } else if (kind === 'uniformItem') {
      await prisma.uniformItem.delete({ where: { id } });
    } else {
      await deleteFeeType(id);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('fees/config DELETE', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to delete' }, { status: 400 });
  }
}
