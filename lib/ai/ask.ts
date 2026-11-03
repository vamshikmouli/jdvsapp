import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@/lib/db';
import { getActiveYear, getReports, getStudentAccount } from '@/lib/services/fees';

// Natural-language "Ask" over fees + attendance. A small, FIXED set of safe
// intents (no arbitrary SQL): Claude only maps the question to an intent + a few
// parameters; every query below is hand-written and permission-scoped.

export const ASK_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5';

export function askConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export type Intent =
  | 'fees_collected'
  | 'fees_pending'
  | 'fees_defaulters'
  | 'student_fees'
  | 'absent_today'
  | 'attendance_today'
  | 'student_attendance'
  | 'unknown';

const FEE_INTENTS = new Set<Intent>(['fees_collected', 'fees_pending', 'fees_defaulters', 'student_fees']);
const ATT_INTENTS = new Set<Intent>(['absent_today', 'attendance_today', 'student_attendance']);

interface Parsed {
  intent: Intent;
  className?: string | null;
  studentName?: string | null;
  period?: 'today' | 'this_month' | 'this_year' | null;
}

export interface AskResult {
  answer: string;
  rows?: { label: string; value?: string }[];
  intent: Intent;
}

const IST_MS = 5.5 * 3600_000;
const istTodayKey = () => new Date(Date.now() + IST_MS).toISOString().slice(0, 10);
const money = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const shortClass = (n: string | null) => (n ? n.replace(/\s?STD$/i, '') : '—');

// ---- 1) Classify the question into an intent + params (Claude) ----
export async function classify(question: string): Promise<Parsed> {
  const classes = await prisma.schoolClass.findMany({ select: { name: true }, orderBy: { name: 'asc' } });
  const classList = classes.map((c) => c.name).join(', ');
  const today = istTodayKey();

  const system = `You convert a school admin's question into ONE structured query. Today is ${today} (India).
Known class names: ${classList || '(none)'}.

Respond with ONLY a JSON object (no prose, no markdown) of this shape:
{"intent": <one of the intents below>, "className": <class name or null>, "studentName": <student name or null>, "period": <"today"|"this_month"|"this_year"|null>}

Intents:
- "fees_collected": how much fee money was collected/received. Set period (default "today").
- "fees_pending": total pending / outstanding / unpaid fees. Optionally className for one class.
- "fees_defaulters": which students have pending fees / haven't paid / defaulters list. Optionally className.
- "student_fees": one named student's fee balance/paid. Requires studentName.
- "absent_today": which students are absent or on leave today. Optionally className.
- "attendance_today": today's attendance summary (present/absent counts). Optionally className.
- "student_attendance": one named student's attendance this month. Requires studentName.
- "unknown": the question is not about fees or attendance, or is unclear.

Match className to the closest known class name (e.g. "5th", "UKG"). If none, use null.`;

  const client = new Anthropic();
  const res = await client.messages.create({
    model: ASK_MODEL,
    max_tokens: 400,
    system,
    messages: [{ role: 'user', content: question.slice(0, 500) }],
  });
  const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('').trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { intent: 'unknown' };
  try {
    const o = JSON.parse(match[0]);
    const intent = (['fees_collected', 'fees_pending', 'fees_defaulters', 'student_fees', 'absent_today', 'attendance_today', 'student_attendance'].includes(o.intent) ? o.intent : 'unknown') as Intent;
    return {
      intent,
      className: typeof o.className === 'string' ? o.className : null,
      studentName: typeof o.studentName === 'string' ? o.studentName : null,
      period: ['today', 'this_month', 'this_year'].includes(o.period) ? o.period : null,
    };
  } catch {
    return { intent: 'unknown' };
  }
}

// ---- helpers ----
async function findClassId(name?: string | null): Promise<{ id: string; name: string } | null> {
  if (!name) return null;
  const bare = name.replace(/\s?STD$/i, '').trim();
  return prisma.schoolClass.findFirst({
    where: { OR: [{ name: { equals: name, mode: 'insensitive' } }, { name: { contains: bare, mode: 'insensitive' } }] },
    select: { id: true, name: true },
  });
}

async function findStudent(name?: string | null) {
  if (!name) return null;
  return prisma.student.findFirst({
    where: { status: 'ACTIVE', name: { contains: name.trim(), mode: 'insensitive' } },
    select: { id: true, name: true, class: { select: { name: true } } },
  });
}

function periodRange(period: Parsed['period']): { from?: string; to?: string; label: string } {
  const today = istTodayKey();
  if (period === 'this_month') return { from: today.slice(0, 7) + '-01', to: today, label: 'this month' };
  if (period === 'this_year') return { from: today.slice(0, 4) + '-01-01', to: today, label: 'this year' };
  return { from: today, to: today, label: 'today' };
}

// ---- 2) Run the chosen intent (permission-scoped) ----
export async function runQuery(p: Parsed, perms: { canFees: boolean; canAttendance: boolean }): Promise<AskResult> {
  const intent = p.intent;
  if (FEE_INTENTS.has(intent) && !perms.canFees) return { intent, answer: 'You don’t have permission to view fees.' };
  if (ATT_INTENTS.has(intent) && !perms.canAttendance) return { intent, answer: 'You don’t have permission to view attendance.' };

  const year = await getActiveYear();

  if (intent === 'fees_collected') {
    const r = periodRange(p.period);
    const rep = await getReports(year.id, { from: r.from, to: r.to });
    const rows = rep.byClass.slice(0, 8).map((c) => ({ label: shortClass(c.name), value: money(c.amount) }));
    return { intent, answer: `Collected ${r.label}: ${money(rep.collectedTotal)} across ${rep.paymentCount} payment(s).`, rows };
  }

  if (intent === 'fees_pending') {
    const rep = await getReports(year.id, {});
    const cls = await findClassId(p.className);
    if (cls) {
      const cs = (rep.classSummary as any[]).find((c) => c.classId === cls.id || c.name === cls.name);
      const pending = cs?.pending ?? 0;
      return { intent, answer: `Pending fees for ${shortClass(cls.name)}: ${money(pending)}${cs ? ` (${cs.withDues} student(s) with dues)` : ''}.` };
    }
    const rows = (rep.classSummary as any[]).filter((c) => c.pending > 0).slice(0, 10).map((c) => ({ label: shortClass(c.name), value: money(c.pending) }));
    return { intent, answer: `Total pending fees: ${money(rep.outstandingTotal)} across ${rep.withDues} student(s).`, rows };
  }

  if (intent === 'fees_defaulters') {
    const rep = await getReports(year.id, {});
    const cls = await findClassId(p.className);
    let list = rep.outstanding as { name: string; className: string | null; balance: number }[];
    if (cls) list = list.filter((o) => o.className === cls.name);
    const rows = list.slice(0, 25).map((o) => ({ label: `${o.name}${o.className ? ` · ${shortClass(o.className)}` : ''}`, value: money(o.balance) }));
    const where = cls ? ` in ${shortClass(cls.name)}` : '';
    return { intent, answer: `${list.length} student(s)${where} have pending fees${list.length > 25 ? ' (showing first 25)' : ''}.`, rows };
  }

  if (intent === 'student_fees') {
    const st = await findStudent(p.studentName);
    if (!st) return { intent, answer: `Couldn’t find a student named “${p.studentName ?? ''}”.` };
    const acc = await getStudentAccount(st.id, year.id);
    const s = acc?.summary;
    if (!s) return { intent, answer: `No fee account found for ${st.name}.` };
    return {
      intent,
      answer: `${st.name}${st.class ? ` (${shortClass(st.class.name)})` : ''} — balance ${money(s.totalBalance)}.`,
      rows: [
        { label: 'Total fee', value: money(s.totalCharged) },
        { label: 'Concession', value: money(s.concession) },
        { label: 'Paid', value: money(s.totalPaid) },
        { label: 'Balance', value: money(s.totalBalance) },
      ],
    };
  }

  // ----- attendance -----
  const today = istTodayKey();
  const todayDate = new Date(`${today}T00:00:00Z`);

  if (intent === 'absent_today' || intent === 'attendance_today') {
    const cls = await findClassId(p.className);
    const recs = await prisma.attendanceRecord.findMany({
      where: { session: { date: todayDate, ...(cls ? { classId: cls.id } : {}) } },
      select: { status: true, student: { select: { id: true, name: true } }, session: { select: { class: { select: { name: true } } } } },
    });
    // One student may appear in multiple slots — collapse to the "worst" status.
    const rank: Record<string, number> = { ABSENT: 4, LEAVE: 3, LATE: 2, PRESENT: 1 };
    const byStudent = new Map<string, { name: string; className: string | null; status: string }>();
    for (const r of recs) {
      const cur = byStudent.get(r.student.id);
      if (!cur || (rank[r.status] ?? 0) > (rank[cur.status] ?? 0)) byStudent.set(r.student.id, { name: r.student.name, className: r.session.class?.name ?? null, status: r.status });
    }
    const all = [...byStudent.values()];
    const where = cls ? ` in ${shortClass(cls.name)}` : '';
    if (all.length === 0) return { intent, answer: `No student attendance has been marked${where} today yet.` };

    if (intent === 'attendance_today') {
      const c = { PRESENT: 0, ABSENT: 0, LATE: 0, LEAVE: 0 } as Record<string, number>;
      for (const s of all) c[s.status] = (c[s.status] ?? 0) + 1;
      return {
        intent,
        answer: `Today${where}: ${c.PRESENT} present, ${c.ABSENT} absent, ${c.LEAVE} on leave, ${c.LATE} late (of ${all.length} marked).`,
        rows: [
          { label: 'Present', value: String(c.PRESENT) }, { label: 'Absent', value: String(c.ABSENT) },
          { label: 'Leave', value: String(c.LEAVE) }, { label: 'Late', value: String(c.LATE) },
        ],
      };
    }
    const absent = all.filter((s) => s.status === 'ABSENT' || s.status === 'LEAVE');
    const rows = absent.slice(0, 40).map((s) => ({ label: `${s.name}${s.className ? ` · ${shortClass(s.className)}` : ''}`, value: s.status === 'LEAVE' ? 'Leave' : 'Absent' }));
    return { intent, answer: `${absent.length} student(s)${where} are absent or on leave today${absent.length > 40 ? ' (showing first 40)' : ''}.`, rows };
  }

  if (intent === 'student_attendance') {
    const st = await findStudent(p.studentName);
    if (!st) return { intent, answer: `Couldn’t find a student named “${p.studentName ?? ''}”.` };
    const from = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
    const recs = await prisma.attendanceRecord.findMany({
      where: { studentId: st.id, session: { date: { gte: from, lte: todayDate } } },
      select: { status: true, session: { select: { date: true } } },
    });
    // Collapse to one status per day (worst of the day's slots).
    const rank: Record<string, number> = { ABSENT: 4, LEAVE: 3, LATE: 2, PRESENT: 1 };
    const byDay = new Map<string, string>();
    for (const r of recs) {
      const dk = r.session.date.toISOString().slice(0, 10);
      const cur = byDay.get(dk);
      if (!cur || (rank[r.status] ?? 0) > (rank[cur] ?? 0)) byDay.set(dk, r.status);
    }
    let present = 0, absent = 0, leave = 0, late = 0;
    for (const s of byDay.values()) { if (s === 'PRESENT') present++; else if (s === 'ABSENT') absent++; else if (s === 'LEAVE') leave++; else if (s === 'LATE') late++; }
    const marked = byDay.size;
    const pct = marked ? Math.round(((present + late) / marked) * 100) : 0;
    return {
      intent,
      answer: `${st.name}${st.class ? ` (${shortClass(st.class.name)})` : ''} — this month: present ${present + late}/${marked} days (${pct}%).`,
      rows: [
        { label: 'Present', value: String(present) }, { label: 'Late', value: String(late) },
        { label: 'Absent', value: String(absent) }, { label: 'Leave', value: String(leave) },
      ],
    };
  }

  return { intent: 'unknown', answer: 'I can answer questions about fees and attendance — e.g. “pending fees for 5th”, “who is absent today”, “how much collected this month”, “Asha’s fee balance”.' };
}
