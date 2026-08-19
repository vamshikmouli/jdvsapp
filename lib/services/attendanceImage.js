// Server-side monthly attendance calendar → PNG (for WhatsApp weekly reports).
// Mirrors components/AttendanceCalendar.tsx (same statuses, colours, labels) so the
// image staff receive matches what they see in the app. Uses @napi-rs/canvas —
// prebuilt native binaries, no system deps — safe on the small prod VM.
//
// renderAttendanceCalendarPng({ staffName, designation, month, days, schoolName })
//   month: "YYYY-MM"
//   days:  [{ date: "YYYY-MM-DD"|ISO, status, late?, halfSession? }]
//   returns: Buffer (PNG)

const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');

// Register fonts so text renders identically on any host (Linux servers often
// ship without a default sans-serif). Falls back to system if none found.
let FONT = 'sans-serif';
let FONT_BOLD = 'sans-serif';
function register(candidates, alias) {
  for (const p of candidates) {
    try { if (fs.existsSync(p) && GlobalFonts.registerFromPath(p, alias)) return alias; } catch { /* next */ }
  }
  return null;
}
FONT = register([
  path.join(__dirname, '..', '..', 'public', 'fonts', 'DejaVuSans.ttf'),
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
], 'AttSans') || 'sans-serif';
FONT_BOLD = register([
  path.join(__dirname, '..', '..', 'public', 'fonts', 'DejaVuSans-Bold.ttf'),
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
], 'AttSansBold') || FONT;

const COLORS = {
  PRESENT:    '#156D3B',
  HALF_DAY:   '#A6620A',
  ABSENT:     '#A4231F',
  LEAVE:      '#155E9C',
  HOLIDAY:    '#6428CC',
  WEEKLY_OFF: '#64748B',
};
const LABEL = { PRESENT: 'P', HALF_DAY: '½', ABSENT: 'A', LEAVE: 'L', HOLIDAY: 'H', WEEKLY_OFF: 'O' };
const EMPTY_FILL = '#F1F5F9';       // slate-100 — unmarked day
const BRAND = '#6428CC';            // purple-600
const INK = '#1E293B';              // slate-800
const MUTED = '#94A3B8';            // slate-400
const GREEN = '#156D3B', RED = '#A4231F';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function renderAttendanceCalendarPng({ staffName, designation, month, days, schoolName }) {
  const [y, m] = month.split('-').map(Number);
  const byDate = new Map((days || []).map((d) => [String(d.date).slice(0, 10), d]));
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const weekRows = Math.ceil((firstWeekday + daysInMonth) / 7);

  // Layout metrics
  const W = 880;
  const PAD = 44;
  const gridW = W - PAD * 2;
  const gap = 10;
  const cell = (gridW - gap * 6) / 7;          // square-ish cells
  const cellH = Math.round(cell * 0.82);
  const headerH = 168;
  const wkH = 34;
  const gridTop = headerH + wkH;
  const gridH = weekRows * cellH + (weekRows - 1) * gap;
  const legendTop = gridTop + gridH + 28;
  const H = legendTop + 128;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);

  // ---- Header ----
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = BRAND;
  ctx.font = `700 24px ${FONT_BOLD}`;
  ctx.fillText(schoolName || 'Jnana Deepika Vidhya Samsthe', PAD, 52);

  ctx.fillStyle = INK;
  ctx.font = `700 34px ${FONT_BOLD}`;
  ctx.fillText(staffName || '', PAD, 100);

  if (designation) {
    ctx.fillStyle = MUTED;
    ctx.font = `500 18px ${FONT}`;
    ctx.fillText(designation, PAD, 126);
  }

  // Month label (right-aligned)
  ctx.fillStyle = INK;
  ctx.font = `600 24px ${FONT_BOLD}`;
  ctx.textAlign = 'right';
  ctx.fillText(`Attendance — ${MONTHS[m - 1]} ${y}`, W - PAD, 100);
  ctx.textAlign = 'left';

  // Divider
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(PAD, headerH - 18); ctx.lineTo(W - PAD, headerH - 18); ctx.stroke();

  // ---- Weekday header ----
  ctx.textAlign = 'center';
  ctx.fillStyle = MUTED;
  ctx.font = `600 15px ${FONT_BOLD}`;
  for (let i = 0; i < 7; i++) {
    const cx = PAD + i * (cell + gap) + cell / 2;
    ctx.fillText(WEEKDAYS[i], cx, headerH + 22);
  }

  // ---- Day cells ----
  const tally = { PRESENT: 0, HALF_DAY: 0, ABSENT: 0, LEAVE: 0, HOLIDAY: 0, WEEKLY_OFF: 0 };
  for (let day = 1; day <= daysInMonth; day++) {
    const idx = firstWeekday + day - 1;
    const col = idx % 7, row = Math.floor(idx / 7);
    const x = PAD + col * (cell + gap);
    const yy = gridTop + row * (cellH + gap);
    const key = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const rec = byDate.get(key);
    const status = rec && COLORS[rec.status] ? rec.status : null;
    if (status) tally[status] = (tally[status] || 0) + 1;

    // Cell background
    if (status === 'HALF_DAY') {
      // split morning|afternoon; halfSession = the OFF session
      const off = rec.halfSession;
      const left = off === 'MORNING' ? RED : GREEN;
      const right = off === 'MORNING' ? GREEN : (off === 'AFTERNOON' ? RED : GREEN);
      roundRect(ctx, x, yy, cell, cellH, 12); ctx.save(); ctx.clip();
      ctx.fillStyle = left; ctx.fillRect(x, yy, cell / 2, cellH);
      ctx.fillStyle = off === 'AFTERNOON' ? RED : right; ctx.fillRect(x + cell / 2, yy, cell / 2, cellH);
      ctx.restore();
    } else {
      roundRect(ctx, x, yy, cell, cellH, 12);
      ctx.fillStyle = status ? COLORS[status] : EMPTY_FILL;
      ctx.fill();
    }

    // Day number (top-left)
    ctx.textAlign = 'left';
    ctx.fillStyle = status ? 'rgba(255,255,255,0.8)' : MUTED;
    ctx.font = `500 13px ${FONT}`;
    ctx.fillText(String(day), x + 10, yy + 22);

    // Big status label (center)
    if (status && LABEL[status]) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `700 26px ${FONT_BOLD}`;
      ctx.fillText(LABEL[status], x + cell / 2, yy + cellH / 2 + 14);
    }

    // Late dot (top-right)
    if (rec && rec.late) {
      ctx.beginPath();
      ctx.arc(x + cell - 12, yy + 12, 5, 0, Math.PI * 2);
      ctx.fillStyle = RED; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#FFFFFF'; ctx.stroke();
    }
  }

  // ---- Legend ----
  const legend = [
    ['Present', GREEN], ['Half day', 'split'], ['Absent', RED],
    ['Leave', COLORS.LEAVE], ['Holiday', COLORS.HOLIDAY], ['Off', COLORS.WEEKLY_OFF],
  ];
  ctx.textAlign = 'left';
  let lx = PAD;
  const ly = legendTop;
  ctx.font = `500 15px ${FONT}`;
  for (const [label, col] of legend) {
    roundRect(ctx, lx, ly - 12, 16, 16, 4);
    if (col === 'split') {
      ctx.save(); ctx.clip();
      ctx.fillStyle = GREEN; ctx.fillRect(lx, ly - 12, 8, 16);
      ctx.fillStyle = RED; ctx.fillRect(lx + 8, ly - 12, 8, 16);
      ctx.restore();
    } else { ctx.fillStyle = col; ctx.fill(); }
    ctx.fillStyle = '#475569';
    ctx.fillText(label, lx + 24, ly + 2);
    lx += 24 + ctx.measureText(label).width + 28;
  }

  // ---- Summary ----
  const sy = legendTop + 44;
  const parts = [
    [`${tally.PRESENT} present`, GREEN],
    [`${tally.HALF_DAY} half`, COLORS.HALF_DAY],
    [`${tally.ABSENT} absent`, RED],
    [`${tally.LEAVE} leave`, COLORS.LEAVE],
  ];
  let sx = PAD;
  ctx.font = `700 18px ${FONT_BOLD}`;
  for (const [txt, col] of parts) {
    ctx.fillStyle = col;
    ctx.fillText(txt, sx, sy);
    sx += ctx.measureText(txt).width + 26;
  }

  // ---- Footer ----
  ctx.fillStyle = MUTED;
  ctx.font = `400 13px ${FONT}`;
  const gen = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  ctx.fillText(`Generated ${gen} · ${schoolName || 'Jnana Deepika Vidhya Samsthe'}`, PAD, H - 22);

  return canvas.toBuffer('image/png');
}

// ---- Daily all-staff board (admin digest) ----
const STATUS_TEXT = { PRESENT: 'Present', HALF_DAY: 'Half day', ABSENT: 'Absent', LEAVE: 'Leave', HOLIDAY: 'Holiday', WEEKLY_OFF: 'Weekly off' };
function fmtT(v) {
  if (!v) return '—';
  try { return new Date(v).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }); }
  catch { return '—'; }
}

// rows: [{ name, designation, status, firstIn, lastOut, late, lateMinutes }]
function renderDailyBoardPng({ dateLabel, timeLabel, rows, schoolName }) {
  rows = rows || [];
  const tally = { PRESENT: 0, HALF_DAY: 0, ABSENT: 0, LEAVE: 0, HOLIDAY: 0, WEEKLY_OFF: 0, late: 0 };
  for (const r of rows) { tally[r.status] = (tally[r.status] || 0) + 1; if (r.late) tally.late++; }

  const W = 860, PAD = 40;
  const headerH = 150, sumH = 46, theadH = 34, rowH = 34;
  const top = headerH + sumH + theadH;
  const H = top + rows.length * rowH + 60;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, H);

  // Header
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.fillStyle = BRAND; ctx.font = `700 22px ${FONT_BOLD}`;
  ctx.fillText(schoolName || 'Jnana Deepika Vidhya Samsthe', PAD, 48);
  ctx.fillStyle = INK; ctx.font = `700 30px ${FONT_BOLD}`;
  ctx.fillText('Staff Attendance', PAD, 90);
  ctx.fillStyle = MUTED; ctx.font = `500 17px ${FONT}`;
  ctx.fillText(dateLabel || '', PAD, 116);
  ctx.textAlign = 'right';
  ctx.fillStyle = MUTED; ctx.font = `500 16px ${FONT}`;
  ctx.fillText(`as of ${timeLabel || ''}`, W - PAD, 90);
  ctx.textAlign = 'left';

  // Summary chips
  const chips = [
    [`${tally.PRESENT} Present`, COLORS.PRESENT],
    [`${tally.ABSENT} Absent`, COLORS.ABSENT],
    [`${tally.late} Late`, RED],
    [`${tally.LEAVE} Leave`, COLORS.LEAVE],
    [`${tally.HALF_DAY} Half`, COLORS.HALF_DAY],
    [`${(tally.HOLIDAY + tally.WEEKLY_OFF)} Off`, COLORS.WEEKLY_OFF],
  ];
  let cx = PAD; const cy = headerH + 4;
  ctx.font = `700 15px ${FONT_BOLD}`;
  for (const [txt, col] of chips) {
    const w = ctx.measureText(txt).width + 28;
    roundRect(ctx, cx, cy - 20, w, 28, 14); ctx.fillStyle = col + '22'; ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 14, cy - 6, 4, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
    ctx.fillStyle = col; ctx.fillText(txt, cx + 24, cy - 1);
    cx += w + 10;
  }

  // Column x positions
  const cName = PAD, cStatus = PAD + 330, cIn = PAD + 560, cOut = PAD + 700;

  // Table head
  const thy = headerH + sumH;
  ctx.fillStyle = '#F8FAFC'; ctx.fillRect(PAD, thy, W - PAD * 2, theadH);
  ctx.fillStyle = MUTED; ctx.font = `700 13px ${FONT_BOLD}`;
  ctx.fillText('NAME', cName + 12, thy + 22);
  ctx.fillText('STATUS', cStatus, thy + 22);
  ctx.fillText('IN', cIn, thy + 22);
  ctx.fillText('OUT', cOut, thy + 22);

  // Rows
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    if (i % 2 === 1) { ctx.fillStyle = '#FBFCFE'; ctx.fillRect(PAD, y, W - PAD * 2, rowH); }
    // name
    ctx.fillStyle = INK; ctx.font = `600 15px ${FONT_BOLD}`;
    ctx.fillText(r.name.length > 28 ? r.name.slice(0, 27) + '…' : r.name, cName + 12, y + 22);
    // status dot + label
    const col = COLORS[r.status] || MUTED;
    ctx.beginPath(); ctx.arc(cStatus + 5, y + 17, 5, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
    ctx.fillStyle = '#334155'; ctx.font = `500 14px ${FONT}`;
    ctx.fillText(STATUS_TEXT[r.status] || r.status, cStatus + 18, y + 22);
    if (r.late) { ctx.fillStyle = RED; ctx.font = `500 12px ${FONT}`; ctx.fillText(`+${r.lateMinutes || 0}m`, cStatus + 18 + ctx.measureText(STATUS_TEXT[r.status] || '').width + 40, y + 22); }
    // in / out
    ctx.fillStyle = '#475569'; ctx.font = `500 14px ${FONT}`;
    ctx.fillText(fmtT(r.firstIn), cIn, y + 22);
    ctx.fillText(fmtT(r.lastOut), cOut, y + 22);
    // row divider
    ctx.strokeStyle = '#EEF2F6'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD, y + rowH); ctx.lineTo(W - PAD, y + rowH); ctx.stroke();
  });

  // Footer
  ctx.fillStyle = MUTED; ctx.font = `400 12px ${FONT}`;
  ctx.fillText(`${rows.length} staff · Generated ${new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(11, 16)} IST · ${schoolName || 'Jnana Deepika Vidhya Samsthe'}`, PAD, H - 24);

  return canvas.toBuffer('image/png');
}

module.exports = { renderAttendanceCalendarPng, renderDailyBoardPng };
