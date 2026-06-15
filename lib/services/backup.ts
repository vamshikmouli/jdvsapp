import { prisma } from '@/lib/db';

// ============================================================================
// Excel backup / restore.
//
// One workbook, one sheet per DB table. Every row carries its real primary key
// and foreign keys, so a re-import upserts by id and reproduces the same state
// ("same as before in db"). Restore is non-destructive: rows present in the DB
// but absent from the workbook are left untouched.
//
// Scope: students, classes, fees (config + assignments + charges + payments +
// allocations + concessions + uniform/van), and attendance — plus the academic
// years and fee heads those reference. updatedAt is intentionally not preserved
// (Prisma manages @updatedAt automatically).
// ============================================================================

type ColType = 'string' | 'int' | 'bool' | 'date' | 'datetime';

// Which page each table belongs to, for per-page exports.
export type BackupGroup = 'students' | 'classes' | 'fees' | 'attendance' | 'staff' | 'marks';

interface Col {
  key: string;
  type: ColType;
  nullable?: boolean;
}

interface TableSpec {
  sheet: string;        // Excel sheet name
  model: string;        // prisma delegate (camelCase)
  group: BackupGroup;   // owning page (for ?group= exports)
  columns: Col[];       // must include 'id'
  orderBy?: Record<string, 'asc' | 'desc'>;
  userFkCols?: string[]; // FK columns pointing at User — nulled on restore if the user is missing
}

const c = (key: string, type: ColType, nullable = false): Col => ({ key, type, nullable });

// Dependency order: parents before children (used as-is for import; export order
// is irrelevant but the same list keeps the two in lock-step).
const TABLES: TableSpec[] = [
  {
    sheet: 'AcademicYears', model: 'academicYear', group: 'fees',
    columns: [c('id', 'string'), c('label', 'string'), c('isActive', 'bool'), c('createdAt', 'datetime')],
  },
  {
    sheet: 'Classes', model: 'schoolClass', group: 'classes', orderBy: { order: 'asc' },
    columns: [
      c('id', 'string'), c('name', 'string'), c('order', 'int'), c('room', 'string', true),
      c('group', 'string'), c('archived', 'bool'), c('createdAt', 'datetime'),
    ],
  },
  {
    sheet: 'Sections', model: 'section', group: 'classes',
    columns: [c('id', 'string'), c('name', 'string'), c('classId', 'string'), c('createdAt', 'datetime')],
  },
  {
    sheet: 'Staff', model: 'staff', group: 'staff', userFkCols: ['userId'],
    columns: [
      c('id', 'string'), c('userId', 'string', true), c('name', 'string'), c('email', 'string', true),
      c('phone', 'string', true), c('designation', 'string', true), c('dob', 'date', true),
      c('joiningDate', 'date', true), c('serviceJoiningDate', 'date', true), c('durationEmployment', 'string', true),
      c('subjectSpecialization', 'string', true), c('experience', 'string', true), c('archived', 'bool'),
      c('createdAt', 'datetime'),
    ],
  },
  {
    sheet: 'FeeTypes', model: 'feeType', group: 'fees', orderBy: { order: 'asc' },
    columns: [
      c('id', 'string'), c('key', 'string'), c('name', 'string'), c('billingMode', 'string'),
      c('installmentable', 'bool'), c('autoAssign', 'bool'), c('order', 'int'), c('active', 'bool'),
      c('createdAt', 'datetime'),
    ],
  },
  {
    sheet: 'Students', model: 'student', group: 'students', userFkCols: ['guardianUserId'],
    columns: [
      c('id', 'string'), c('name', 'string'), c('classId', 'string', true), c('sectionId', 'string', true),
      c('roll', 'string', true), c('gender', 'string'), c('dob', 'date', true), c('religion', 'string', true),
      c('category', 'string', true), c('caste', 'string', true), c('address', 'string', true),
      c('fatherName', 'string', true), c('fatherPhone', 'string', true), c('motherName', 'string', true),
      c('motherPhone', 'string', true), c('smsFor', 'string', true), c('photoUrl', 'string', true),
      c('guardianName', 'string'), c('guardianPhone', 'string'), c('guardianUserId', 'string', true),
      c('village', 'string', true), c('status', 'string'), c('joinedDate', 'datetime', true),
      c('createdAt', 'datetime'),
    ],
  },
  {
    sheet: 'Enrollments', model: 'enrollment', group: 'students',
    columns: [
      c('id', 'string'), c('studentId', 'string'), c('yearId', 'string'), c('classId', 'string'),
      c('sectionId', 'string', true), c('roll', 'string', true), c('status', 'string'), c('createdAt', 'datetime'),
    ],
  },
  {
    sheet: 'ClassFees', model: 'classFee', group: 'fees',
    columns: [
      c('id', 'string'), c('yearId', 'string'), c('classId', 'string'), c('feeTypeId', 'string'), c('amount', 'int'),
    ],
  },
  {
    sheet: 'ClassFeeInstallments', model: 'classFeeInstallment', group: 'fees',
    columns: [c('id', 'string'), c('classFeeId', 'string'), c('n', 'int'), c('amount', 'int'), c('dueDate', 'date')],
  },
  {
    sheet: 'VanFees', model: 'vanFee', group: 'fees',
    columns: [
      c('id', 'string'), c('yearId', 'string'), c('village', 'string'), c('monthlyFee', 'int'), c('annualFee', 'int'),
    ],
  },
  {
    sheet: 'VanFeeInstallments', model: 'vanFeeInstallment', group: 'fees',
    columns: [c('id', 'string'), c('vanFeeId', 'string'), c('n', 'int'), c('amount', 'int'), c('dueDate', 'date')],
  },
  {
    sheet: 'UniformItems', model: 'uniformItem', group: 'fees', orderBy: { order: 'asc' },
    columns: [
      c('id', 'string'), c('yearId', 'string'), c('name', 'string'), c('price', 'int'),
      c('defaultQty', 'int'), c('active', 'bool'), c('order', 'int'),
    ],
  },
  {
    sheet: 'FeeAssignments', model: 'studentFeeAssignment', group: 'fees',
    columns: [
      c('id', 'string'), c('studentId', 'string'), c('yearId', 'string'), c('oldDue', 'int'),
      c('concession', 'int'), c('concessionReason', 'string', true), c('note', 'string', true), c('createdAt', 'datetime'),
    ],
  },
  {
    sheet: 'FeeCharges', model: 'feeCharge', group: 'fees',
    columns: [
      c('id', 'string'), c('assignmentId', 'string'), c('feeTypeId', 'string'), c('label', 'string'),
      c('amount', 'int'), c('dueDate', 'date', true), c('installmentNo', 'int', true), c('createdAt', 'datetime'),
    ],
  },
  {
    sheet: 'UniformSelections', model: 'uniformSelection', group: 'fees',
    columns: [c('id', 'string'), c('assignmentId', 'string'), c('uniformItemId', 'string'), c('qty', 'int')],
  },
  {
    sheet: 'Payments', model: 'payment', group: 'fees', orderBy: { paidAt: 'asc' },
    columns: [
      c('id', 'string'), c('studentId', 'string'), c('yearId', 'string'), c('receiptNo', 'string'),
      c('method', 'string'), c('total', 'int'), c('note', 'string', true), c('collectedById', 'string', true),
      c('paidAt', 'datetime'), c('voided', 'bool'), c('voidedAt', 'datetime', true),
      c('voidReason', 'string', true), c('voidedById', 'string', true),
    ],
  },
  {
    sheet: 'PaymentAllocations', model: 'paymentAllocation', group: 'fees',
    columns: [c('id', 'string'), c('paymentId', 'string'), c('feeChargeId', 'string'), c('amount', 'int')],
  },
  {
    sheet: 'Concessions', model: 'concession', group: 'fees',
    columns: [
      c('id', 'string'), c('assignmentId', 'string'), c('feeTypeId', 'string'), c('amount', 'int'),
      c('reason', 'string'), c('status', 'string'), c('requestedById', 'string', true),
      c('approvedById', 'string', true), c('decisionNote', 'string', true), c('decidedAt', 'datetime', true),
      c('createdAt', 'datetime'),
    ],
  },
  {
    sheet: 'AttendanceSessions', model: 'attendanceSession', group: 'attendance', orderBy: { date: 'asc' },
    columns: [
      c('id', 'string'), c('classId', 'string'), c('date', 'date'), c('slot', 'string'),
      c('locked', 'bool'), c('takenById', 'string', true), c('createdAt', 'datetime'),
    ],
  },
  {
    sheet: 'AttendanceRecords', model: 'attendanceRecord', group: 'attendance',
    columns: [
      c('id', 'string'), c('sessionId', 'string'), c('studentId', 'string'), c('status', 'string'), c('createdAt', 'datetime'),
    ],
  },

  // ----- Marks: configuration (subjects, grade scale, assessments, maps) then data -----
  {
    sheet: 'Subjects', model: 'subject', group: 'marks', orderBy: { order: 'asc' },
    columns: [
      c('id', 'string'), c('name', 'string'), c('code', 'string', true), c('order', 'int'),
      c('active', 'bool'), c('gradeOnly', 'bool'), c('createdAt', 'datetime'),
    ],
  },
  {
    sheet: 'GradeBands', model: 'gradeBand', group: 'marks', orderBy: { order: 'asc' },
    columns: [
      c('id', 'string'), c('label', 'string'), c('minPercent', 'int'), c('maxPercent', 'int'),
      c('order', 'int'), c('createdAt', 'datetime'),
    ],
  },
  {
    sheet: 'Assessments', model: 'assessment', group: 'marks', orderBy: { order: 'asc' },
    columns: [
      c('id', 'string'), c('yearId', 'string'), c('name', 'string'), c('type', 'string'),
      c('term', 'string', true), c('order', 'int'), c('defaultMax', 'int'),
      c('publishedToParents', 'bool'), c('archived', 'bool'), c('createdAt', 'datetime'),
    ],
  },
  {
    sheet: 'ClassSubjects', model: 'classSubject', group: 'marks',
    columns: [
      c('id', 'string'), c('classId', 'string'), c('subjectId', 'string'), c('order', 'int'), c('createdAt', 'datetime'),
    ],
  },
  {
    sheet: 'AssessmentSubjects', model: 'assessmentSubject', group: 'marks',
    columns: [c('id', 'string'), c('assessmentId', 'string'), c('subjectId', 'string'), c('maxMarks', 'int')],
  },
  {
    sheet: 'MarkSheets', model: 'markSheet', group: 'marks', userFkCols: ['enteredById', 'approvedById'],
    columns: [
      c('id', 'string'), c('assessmentId', 'string'), c('classId', 'string'), c('sectionId', 'string', true),
      c('subjectId', 'string'), c('maxMarks', 'int'), c('status', 'string'), c('enteredById', 'string', true),
      c('approvedById', 'string', true), c('submittedAt', 'datetime', true), c('approvedAt', 'datetime', true),
      c('createdAt', 'datetime'),
    ],
  },
  {
    sheet: 'Marks', model: 'mark', group: 'marks',
    columns: [
      c('id', 'string'), c('markSheetId', 'string'), c('studentId', 'string'), c('marksObtained', 'int', true),
      c('isAbsent', 'bool'), c('remark', 'string', true), c('createdAt', 'datetime'),
    ],
  },
];

// ---- serialise a DB value into an Excel-cell-friendly value ----
function serialise(v: any, type: ColType): string | number | boolean {
  if (v === null || v === undefined) return '';
  switch (type) {
    case 'date':
    case 'datetime':
      return v instanceof Date ? v.toISOString() : String(v);
    case 'bool':
      return v ? 'TRUE' : 'FALSE';
    case 'int':
      return typeof v === 'number' ? v : Number(v) || 0;
    default:
      return String(v);
  }
}

// ---- parse an Excel-cell value back into a Prisma-ready value ----
function parseCell(v: any, type: ColType, nullable: boolean): any {
  const empty = v === '' || v === null || v === undefined;
  if (empty) return nullable ? null : type === 'int' ? 0 : type === 'bool' ? false : '';
  switch (type) {
    case 'date':
    case 'datetime': {
      const d = v instanceof Date ? v : new Date(v);
      return isNaN(d.getTime()) ? (nullable ? null : new Date()) : d;
    }
    case 'bool':
      return v === true || v === 1 || ['TRUE', 'true', '1', 'YES', 'yes'].includes(String(v).trim());
    case 'int':
      return Math.round(Number(String(v).replace(/[^0-9.-]/g, '')) || 0);
    default:
      return String(v);
  }
}

export interface BackupSheet {
  sheet: string;
  header: string[];
  rows: Record<string, string | number | boolean>[];
}

// Build the export: one BackupSheet per table. Pass `groups` to export only the
// tables owned by those pages (e.g. ['students']); omit for a full backup.
export async function buildBackup(groups?: BackupGroup[]): Promise<BackupSheet[]> {
  const out: BackupSheet[] = [];
  const tables = groups && groups.length ? TABLES.filter((t) => groups.includes(t.group)) : TABLES;
  for (const t of tables) {
    const records: any[] = await (prisma as any)[t.model].findMany(
      t.orderBy ? { orderBy: t.orderBy } : undefined,
    );
    const rows = records.map((r) => {
      const o: Record<string, string | number | boolean> = {};
      for (const col of t.columns) o[col.key] = serialise(r[col.key], col.type);
      return o;
    });
    out.push({ sheet: t.sheet, header: t.columns.map((col) => col.key), rows });
  }
  return out;
}

export interface RestoreResult {
  sheet: string;
  total: number;
  upserted: number;
  failed: number;
  errors: string[];
}

// Restore from parsed sheets: { [sheetName]: rowObjects[] }. Upserts every row
// by id, in FK-safe order. Cross-scope user FKs that don't resolve are nulled so
// a restore into a fresh DB doesn't fail. Pass `groups` to restrict which tables
// are touched (e.g. ['attendance']) — sheets outside those groups are ignored
// even if present in the file.
export async function restoreBackup(sheets: Record<string, any[]>, groups?: BackupGroup[]): Promise<RestoreResult[]> {
  const userIds = new Set((await prisma.user.findMany({ select: { id: true } })).map((u) => u.id));
  const results: RestoreResult[] = [];
  const tables = groups && groups.length ? TABLES.filter((t) => groups.includes(t.group)) : TABLES;

  for (const t of tables) {
    const rows = Array.isArray(sheets[t.sheet]) ? sheets[t.sheet] : [];
    const res: RestoreResult = { sheet: t.sheet, total: rows.length, upserted: 0, failed: 0, errors: [] };

    for (const raw of rows) {
      try {
        const data: any = {};
        for (const col of t.columns) {
          if (raw[col.key] === undefined) continue;
          data[col.key] = parseCell(raw[col.key], col.type, !!col.nullable);
        }
        // Null out User FKs that don't resolve, so a restore into a fresh DB
        // doesn't fail on a missing guardian / staff login account.
        for (const fk of t.userFkCols || []) {
          if (data[fk] && !userIds.has(data[fk])) data[fk] = null;
        }
        const id = data.id;
        if (!id) { res.failed++; if (res.errors.length < 20) res.errors.push('Row is missing an id'); continue; }
        const { id: _omit, ...update } = data;
        await (prisma as any)[t.model].upsert({ where: { id }, create: data, update });
        res.upserted++;
      } catch (err) {
        res.failed++;
        if (res.errors.length < 20) res.errors.push(err instanceof Error ? err.message : String(err));
      }
    }
    results.push(res);
  }

  return results;
}
