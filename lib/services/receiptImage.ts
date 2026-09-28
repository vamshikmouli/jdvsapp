// Server-side receipt image renderer (no browser) using @napi-rs/canvas.
// Draws a compact receipt PNG for WhatsApp. Uses "Rs." (no ₹ glyph) for font safety.
// The canvas library is lazy-required so a missing package or font never crashes
// the caller — it simply reports unavailable and callers fall back to a text receipt.
import fs from 'fs';

let FONT = '';
let createCanvas: any = null;
let loadImage: any = null;
(() => {
  try {
    const canvasLib = require('@napi-rs/canvas');
    createCanvas = canvasLib.createCanvas;
    loadImage = canvasLib.loadImage;
    const GlobalFonts = canvasLib.GlobalFonts;
    const reg: string[] = [
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
      '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
      '/usr/share/fonts/dejavu/DejaVuSans.ttf',
      'C:\\Windows\\Fonts\\arial.ttf',
    ];
    const bold: string[] = [
      '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
      '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf',
      '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
      'C:\\Windows\\Fonts\\arialbd.ttf',
    ];
    for (const p of reg) { if (fs.existsSync(p) && GlobalFonts.registerFromPath(p, 'RcptSans')) { FONT = 'RcptSans'; break; } }
    if (FONT) for (const p of bold) { if (fs.existsSync(p)) { GlobalFonts.registerFromPath(p, 'RcptSans'); break; } }
  } catch { /* package or font missing → text fallback */ }
})();

export function receiptImageAvailable(): boolean { return !!(FONT && createCanvas); }

export interface ReceiptImageData {
  schoolName?: string;              // omit for the uniform receipt (no school name)
  title: string;                    // e.g. "FEE RECEIPT" / "UNIFORM RECEIPT"
  studentName: string;
  klass: string;
  sub: string;                      // receipt no · date · method (this transaction)
  rows: [string, string][];         // [item, amount paid] — THIS transaction only
  totalAmount: string;              // total paid in this receipt
  balanceLabel?: string;            // e.g. "Balance due" / "Balance" — omit to hide the row
  balanceValue?: string;            // e.g. "Rs. 8,000" / "No dues" (pre-formatted)
  note?: string;                    // optional footer line
  qrPng?: Buffer;                   // optional QR (verification) PNG, drawn at the bottom
}

/** Render a per-transaction receipt PNG. Throws if no font is registered. */
export async function renderReceiptImage(d: ReceiptImageData): Promise<Buffer> {
  if (!FONT) throw new Error('No font registered for receipt image');
  const W = 620, PAD = 30, rowH = 30, bandH = 74;
  const hasBalance = !!(d.balanceLabel && d.balanceValue);
  const H = bandH + 30 + 40 + 28 + d.rows.length * rowH + 44 + (hasBalance ? 30 : 0) + (d.note ? 32 : 0) + (d.qrPng ? 100 : 0) + PAD;
  const c = createCanvas(W, H);
  const g = c.getContext('2d');
  const F = (px: number, weight: 'normal' | 'bold' = 'normal') => { g.font = `${weight} ${px}px "${FONT}"`; };
  const cx = W / 2;
  const PURPLE = '#7C3AED', PURPLE_D = '#501FA3', PURPLE_L = '#EBE3FD', INK = '#1C222B', MUTED = '#6B7785', LINE = '#DDE3EB';

  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
  g.textBaseline = 'alphabetic';

  // Purple header band
  g.fillStyle = PURPLE; g.fillRect(0, 0, W, bandH);
  g.textAlign = 'center';
  if (d.schoolName) {
    F(20, 'bold'); g.fillStyle = '#ffffff'; g.fillText(d.schoolName.toUpperCase(), cx, 32);
    F(12, 'bold'); g.fillStyle = PURPLE_L; g.fillText(d.title.toUpperCase(), cx, 55);
  } else {
    F(20, 'bold'); g.fillStyle = '#ffffff'; g.fillText(d.title.toUpperCase(), cx, 44);
  }

  let y = bandH + 30;
  // Student + receipt meta
  g.textAlign = 'left'; F(15, 'bold'); g.fillStyle = INK; g.fillText(d.studentName, PAD, y);
  F(12); g.textAlign = 'right'; g.fillStyle = MUTED; g.fillText(d.klass, W - PAD, y);
  y += 18; F(12); g.textAlign = 'left'; g.fillStyle = MUTED; g.fillText(d.sub, PAD, y);
  y += 20;

  const amtX = W - PAD;
  // Table header band
  g.fillStyle = PURPLE_L; g.fillRect(PAD, y - 15, W - 2 * PAD, 25);
  F(10, 'bold'); g.fillStyle = PURPLE_D;
  g.textAlign = 'left'; g.fillText('ITEM', PAD + 6, y + 2);
  g.textAlign = 'right'; g.fillText('AMOUNT PAID', amtX - 6, y + 2);
  y += 24;

  // Rows — item + amount paid (this transaction)
  for (const r of d.rows) {
    F(14); g.textAlign = 'left'; g.fillStyle = INK;
    let label = r[0];
    while (g.measureText(label).width > W - 2 * PAD - 160 && label.length > 4) label = label.slice(0, -2);
    g.fillText(label, PAD + 6, y + 2);
    F(14, 'bold'); g.textAlign = 'right'; g.fillStyle = INK; g.fillText(r[1], amtX - 6, y + 2);
    g.strokeStyle = LINE; g.lineWidth = 1; g.beginPath(); g.moveTo(PAD, y + 12); g.lineTo(W - PAD, y + 12); g.stroke();
    y += rowH;
  }

  // Total paid band
  g.fillStyle = PURPLE; g.fillRect(PAD, y - 13, W - 2 * PAD, 30);
  F(14, 'bold'); g.fillStyle = '#ffffff'; g.textAlign = 'left'; g.fillText('TOTAL PAID', PAD + 8, y + 7);
  g.textAlign = 'right'; g.fillText(d.totalAmount, amtX - 8, y + 7);
  y += 38;

  // Balance due (year fee position) — mirrors the printed receipt.
  if (hasBalance) {
    const cleared = /^(no dues|nil|cleared)/i.test(d.balanceValue!.trim());
    F(13, 'bold'); g.textAlign = 'left'; g.fillStyle = INK; g.fillText(d.balanceLabel!, PAD + 2, y + 2);
    F(13, 'bold'); g.textAlign = 'right'; g.fillStyle = cleared ? '#156D3B' : '#A4231F';
    g.fillText(d.balanceValue!, amtX - 2, y + 2);
    g.strokeStyle = LINE; g.lineWidth = 1; g.beginPath(); g.moveTo(PAD, y + 12); g.lineTo(W - PAD, y + 12); g.stroke();
    y += 30;
  }

  if (d.note) { F(12, 'bold'); g.textAlign = 'center'; g.fillStyle = MUTED; g.fillText(d.note, cx, y + 4); y += 24; }

  // Verification QR — scan to confirm the receipt is genuine.
  if (d.qrPng && loadImage) {
    try {
      const img = await loadImage(d.qrPng);
      const qs = 68, qx = cx - qs / 2, qy = y + 6;
      g.drawImage(img, qx, qy, qs, qs);
      F(10); g.textAlign = 'center'; g.fillStyle = MUTED; g.fillText('Scan to verify this receipt is genuine', cx, qy + qs + 14);
    } catch { /* skip QR on failure */ }
  }

  return c.toBuffer('image/png');
}
