import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { canAny } from '@/lib/rbac/roles';
import { prisma } from '@/lib/db';
import { getActiveYear } from '@/lib/services/fees';

export const dynamic = 'force-dynamic';

const HEADER = ['Student ID', 'Student Name', 'Phone', 'Class', 'Academic Year', 'Fee Head', 'Assigned', 'Concession', 'Paid', 'Date', 'Payment Mode'];
const MODE_LABEL: Record<string, string> = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card', BANK: 'Bank', CHEQUE: 'Cheque' };

// GET /api/fees/export?yearId=&classId= — fee data in the bulk-IMPORT format,
// one row per (student, fee head, payment). Edit and re-upload via Bulk import.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !canAny(session, ['FEES_VIEW_ALL', 'REPORTS_EXPORT', 'SETTINGS_MANAGE'])) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const sp = req.nextUrl.searchParams;
    const classId = sp.get('classId') || '';
    const year = sp.get('yearId')
      ? await prisma.academicYear.findUnique({ where: { id: sp.get('yearId')! } }) || (await getActiveYear())
      : await getActiveYear();

    const assignments = await prisma.studentFeeAssignment.findMany({
      where: { yearId: year.id, ...(classId ? { student: { classId } } : {}) },
      include: {
        student: { select: { id: true, name: true, guardianPhone: true, fatherPhone: true, class: { select: { name: true } } } },
        charges: {
          include: {
            feeType: { select: { id: true, name: true, order: true } },
            allocations: { include: { payment: { select: { paidAt: true, method: true, voided: true } } } },
          },
        },
        concessions: true,
      },
      orderBy: { student: { name: 'asc' } },
    });

    const rows: (string | number)[][] = [];
    for (const a of assignments) {
      const adm = a.student.id;
      const name = a.student.name;
      const phone = a.student.guardianPhone || a.student.fatherPhone || '';
      const cls = a.student.class?.name || '';

      // Group charges by fee head.
      const heads = new Map<string, { name: string; order: number; assigned: number; chargeIds: string[] }>();
      for (const c of a.charges) {
        const h = heads.get(c.feeTypeId) || { name: c.feeType.name, order: c.feeType.order, assigned: 0, chargeIds: [] };
        h.assigned += c.amount;
        h.chargeIds.push(c.id);
        heads.set(c.feeTypeId, h);
      }

      const sortedHeads = Array.from(heads.entries()).sort((x, y) => x[1].order - y[1].order);
      for (const [feeTypeId, h] of sortedHeads) {
        const concession = a.concessions.filter((co) => co.feeTypeId === feeTypeId && co.status === 'APPROVED').reduce((t, co) => t + co.amount, 0);

        // Payments toward this head, grouped by (date, mode).
        const pays = new Map<string, { date: Date; mode: string; amount: number }>();
        for (const c of a.charges) {
          if (c.feeTypeId !== feeTypeId) continue;
          for (const al of c.allocations) {
            if (al.payment.voided) continue;
            const key = al.payment.paidAt.toISOString() + '|' + al.payment.method;
            const e = pays.get(key) || { date: al.payment.paidAt, mode: al.payment.method, amount: 0 };
            e.amount += al.amount;
            pays.set(key, e);
          }
        }

        const payList = Array.from(pays.values()).sort((p, q) => p.date.getTime() - q.date.getTime());
        if (payList.length === 0) {
          rows.push([adm, name, phone, cls, year.label, h.name, h.assigned, concession, 0, '', '']);
        } else {
          payList.forEach((p) => {
            rows.push([adm, name, phone, cls, year.label, h.name, h.assigned, concession, p.amount, p.date.toISOString().slice(0, 10), MODE_LABEL[p.mode] || p.mode]);
          });
        }
      }
    }

    const ws = XLSX.utils.aoa_to_sheet([HEADER, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Fees');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="fees-${year.id}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('fees/export', err);
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
}
