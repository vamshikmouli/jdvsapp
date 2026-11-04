// WhatsApp Cloud API (Meta) — media upload + template send.
// Used by the weekly attendance-report cron to deliver each staff member's
// monthly calendar image. Config comes from env (set on the VM .env):
//   WHATSAPP_TOKEN            — permanent System User access token
//   WHATSAPP_PHONE_NUMBER_ID  — the sending number's Phone Number ID
//   WHATSAPP_TEMPLATE_NAME    — approved template (default: weekly_attendance_report)
//   WHATSAPP_TEMPLATE_LANG    — template language code (default: en)
import { parseContactTargets } from '@/lib/contactTargets';

const GRAPH = 'https://graph.facebook.com/v21.0';

export function whatsappConfigured(): boolean {
  return !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

/** Normalise an Indian phone to WhatsApp's wa_id form (country code, digits only). */
export function toWaNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let d = String(phone).replace(/\D/g, '');
  if (d.length === 10) d = '91' + d;            // bare 10-digit → prepend India
  else if (d.length === 12 && d.startsWith('91')) { /* already 91XXXXXXXXXX */ }
  else if (d.length === 11 && d.startsWith('0')) d = '91' + d.slice(1);
  else if (d.length < 10) return null;          // too short to be valid
  return d;
}

// Who should receive a student's fee reminders & receipts on WhatsApp:
// the father, the mother, and the extra fee-contact number (all deduped).
// Falls back to the guardian number when none of those produce a valid number.
export function feeWaRecipients(s: {
  fatherName?: string | null; fatherPhone?: string | null;
  motherName?: string | null; motherPhone?: string | null;
  altGuardianName?: string | null; altGuardianPhone?: string | null;
  guardianName?: string | null; guardianPhone?: string | null;
  smsFor?: string | null;
  whatsappEnabled?: boolean | null;
}): { name: string; to: string }[] {
  // Legacy opt-out flag still honoured if some old record has it off.
  if (s.whatsappEnabled === false) return [];
  const out: { name: string; to: string }[] = [];
  const seen = new Set<string>();
  const add = (name: string | null | undefined, phone: string | null | undefined) => {
    const to = toWaNumber(phone); if (!to || seen.has(to)) return; seen.add(to);
    out.push({ name: name || 'Parent', to });
  };
  // The student's contact setting is a set (any of Father / Mother / Guardian) —
  // send to each selected party that has a number.
  for (const t of parseContactTargets(s.smsFor)) {
    if (t === 'FATHER') add(s.fatherName, s.fatherPhone);
    else if (t === 'MOTHER') add(s.motherName, s.motherPhone);
    else if (t === 'GUARDIAN') add(s.altGuardianName, s.altGuardianPhone);
  }
  // No chosen number on file — fall back to the resolved primary/guardian number.
  if (out.length === 0) add(s.guardianName || s.fatherName, s.guardianPhone);
  return out;
}

// ---- Template & account management (for the in-app WhatsApp admin page) ----

/** List all message templates with their review status. */
export async function listTemplates(): Promise<{ name: string; status: string; category: string; language: string }[]> {
  const token = process.env.WHATSAPP_TOKEN;
  const waba = process.env.WHATSAPP_WABA_ID;
  if (!token || !waba) return [];
  const res = await fetch(`${GRAPH}/${waba}/message_templates?fields=name,status,category,language&limit=200&access_token=${token}`);
  const j: any = await res.json().catch(() => ({}));
  return (j.data || []).map((t: any) => ({ name: t.name, status: t.status, category: t.category, language: t.language }));
}

/** Connection/health of the sending number. */
export async function getPhoneStatus(): Promise<any> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) return { configured: false };
  const res = await fetch(`${GRAPH}/${phoneId}?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier,status,code_verification_status&access_token=${token}`);
  const j: any = await res.json().catch(() => ({}));
  if (j.error) return { configured: true, error: j.error.message };
  return { configured: true, ...j };
}

function bodyExample(body: string, examples?: string[]) {
  const n = (body.match(/\{\{\d+\}\}/g) || []).length;
  if (!n) return undefined;
  // Realistic samples help Meta's review pick the right category.
  return { body_text: [Array.from({ length: n }, (_, i) => examples?.[i] || `Sample ${i + 1}`)] };
}

/**
 * Create an image-header template. `sample` is a representative PNG (the app
 * supplies one so the user needn't upload). Returns the initial review status.
 */
export async function createImageTemplate(opts: {
  name: string; category: 'UTILITY' | 'MARKETING'; body: string; footer?: string; sample: Buffer; examples?: string[];
}): Promise<{ ok: boolean; status?: string; id?: string; error?: string }> {
  const token = process.env.WHATSAPP_TOKEN;
  const appId = process.env.WHATSAPP_APP_ID;
  const waba = process.env.WHATSAPP_WABA_ID;
  if (!token || !appId || !waba) return { ok: false, error: 'WhatsApp not fully configured (need token, app id, WABA id)' };

  // resumable upload -> header handle
  let r = await fetch(`${GRAPH}/${appId}/uploads?file_length=${opts.sample.length}&file_type=image/png`, { method: 'POST', headers: { Authorization: `OAuth ${token}` } });
  const s: any = await r.json().catch(() => ({}));
  if (!s.id) return { ok: false, error: `upload session failed: ${JSON.stringify(s)}` };
  r = await fetch(`${GRAPH}/${s.id}`, { method: 'POST', headers: { Authorization: `OAuth ${token}`, file_offset: '0' } as any, body: new Uint8Array(opts.sample) });
  const u: any = await r.json().catch(() => ({}));
  if (!u.h) return { ok: false, error: `upload failed: ${JSON.stringify(u)}` };

  const components: any[] = [
    { type: 'HEADER', format: 'IMAGE', example: { header_handle: [u.h] } },
    { type: 'BODY', text: opts.body, ...(bodyExample(opts.body, opts.examples) ? { example: bodyExample(opts.body, opts.examples) } : {}) },
  ];
  if (opts.footer) components.push({ type: 'FOOTER', text: opts.footer });

  r = await fetch(`${GRAPH}/${waba}/message_templates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: opts.name, language: 'en', category: opts.category, components }),
  });
  const t: any = await r.json().catch(() => ({}));
  if (t.error) return { ok: false, error: t.error.error_user_msg || t.error.message };
  return { ok: true, status: t.status, id: t.id };
}

/** Create a TEXT-only template (no image header) — e.g. a reminder. */
export async function createTextTemplate(opts: {
  name: string; category: 'UTILITY' | 'MARKETING'; body: string; footer?: string; examples?: string[];
}): Promise<{ ok: boolean; status?: string; id?: string; error?: string }> {
  const token = process.env.WHATSAPP_TOKEN;
  const waba = process.env.WHATSAPP_WABA_ID;
  if (!token || !waba) return { ok: false, error: 'WhatsApp not fully configured (need token, WABA id)' };
  const components: any[] = [{ type: 'BODY', text: opts.body, ...(bodyExample(opts.body, opts.examples) ? { example: bodyExample(opts.body, opts.examples) } : {}) }];
  if (opts.footer) components.push({ type: 'FOOTER', text: opts.footer });
  const r = await fetch(`${GRAPH}/${waba}/message_templates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: opts.name, language: 'en', category: opts.category, components }),
  });
  const t: any = await r.json().catch(() => ({}));
  if (t.error) return { ok: false, error: t.error.error_user_msg || t.error.message };
  return { ok: true, status: t.status, id: t.id };
}

/**
 * Send a FREE-FORM text message (no template). Only delivers inside an open
 * 24-hour customer-service window — i.e. after the user has messaged us. We use
 * this to reply-confirm a reverse login-verification the user just triggered.
 */
export async function sendWhatsAppText(opts: {
  to: string; text: string;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) return { ok: false, error: 'WhatsApp not configured' };
  const body = {
    messaging_product: 'whatsapp',
    to: opts.to,
    type: 'text',
    text: { preview_url: false, body: opts.text },
  };
  const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: `${res.status} ${JSON.stringify(j?.error || j)}` };
  return { ok: true, id: j?.messages?.[0]?.id };
}

// WhatsApp rejects template BODY parameters that contain newlines, tabs, or 4+
// consecutive spaces (error #132018). Normalise every param: newlines become " · ",
// tabs a space, long space runs collapse. (Line-by-line output is only possible in a
// template's FIXED text, never inside a variable.)
export function waSafeParam(v: string): string {
  return String(v ?? '')
    .replace(/\r/g, '')
    .replace(/\n+/g, ' · ')
    .replace(/\t+/g, ' ')
    .replace(/ {4,}/g, '   ')
    .trim();
}

/** Send a TEXT-only template (no header) with N body variables. */
export async function sendTextTemplate(opts: {
  to: string; templateName: string; lang?: string; bodyParams: string[];
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) return { ok: false, error: 'WhatsApp not configured' };
  const body = {
    messaging_product: 'whatsapp',
    to: opts.to,
    type: 'template',
    template: {
      name: opts.templateName,
      language: { code: opts.lang || 'en' },
      components: opts.bodyParams.length ? [{ type: 'body', parameters: opts.bodyParams.map((t) => ({ type: 'text', text: waSafeParam(t) })) }] : [],
    },
  };
  const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: `${res.status} ${JSON.stringify(j?.error || j)}` };
  return { ok: true, id: j?.messages?.[0]?.id };
}

/**
 * Send an AUTHENTICATION-category template (the only category Meta allows for
 * OTP codes). These templates have a fixed body ("{{1}} is your verification
 * code…") plus a copy-code / one-tap button — and the send payload must repeat
 * the code in BOTH the body and the button component.
 */
export async function sendAuthTemplate(opts: {
  to: string; templateName: string; lang?: string; code: string;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) return { ok: false, error: 'WhatsApp not configured' };
  const body = {
    messaging_product: 'whatsapp',
    to: opts.to,
    type: 'template',
    template: {
      name: opts.templateName,
      language: { code: opts.lang || 'en' },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: opts.code }] },
        // Authentication button: sub_type 'url' + the code as its text param
        // (works for both copy-code and one-tap authentication buttons).
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: opts.code }] },
      ],
    },
  };
  const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: `${res.status} ${JSON.stringify(j?.error || j)}` };
  return { ok: true, id: j?.messages?.[0]?.id };
}

// ---- Billing analytics: per-template spend (Meta template_analytics) ----
// Meta's template_analytics returns, per template per day, how many messages were
// sent/delivered and the amount spent (`cost` → `amount_spent`). It needs analytics
// turned on for the WABA first (a one-way `is_enabled_for_insights=true`), covers at
// most the last 90 days, and accepts up to 10 template ids per request.

/** Is analytics/insights collection turned on for this WABA? null = couldn't tell. */
export async function getWaInsightsEnabled(): Promise<boolean | null> {
  const token = process.env.WHATSAPP_TOKEN;
  const waba = process.env.WHATSAPP_WABA_ID;
  if (!token || !waba) return null;
  const r = await fetch(`${GRAPH}/${waba}?fields=is_enabled_for_insights&access_token=${token}`);
  const j: any = await r.json().catch(() => ({}));
  if (j.error || typeof j.is_enabled_for_insights !== 'boolean') return null;
  return j.is_enabled_for_insights;
}

/** Turn analytics on for this WABA. One-way — Meta can't turn it back off. */
export async function enableWaInsights(): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.WHATSAPP_TOKEN;
  const waba = process.env.WHATSAPP_WABA_ID;
  if (!token || !waba) return { ok: false, error: 'WhatsApp WABA is not configured.' };
  const r = await fetch(`${GRAPH}/${waba}?is_enabled_for_insights=true&access_token=${token}`, { method: 'POST' });
  const j: any = await r.json().catch(() => ({}));
  if (j.error) return { ok: false, error: j.error.error_user_msg || j.error.message || 'Could not enable analytics.' };
  return { ok: true };
}

export interface TemplateSpendRow {
  templateId: string;
  name: string;
  category: string | null;
  sent: number;
  delivered: number;
  amountSpent: number;
}
export interface TemplateSpendReport {
  rows: TemplateSpendRow[];
  total: number;
  error?: string;
}

/**
 * Per-template amount spent between two YYYY-MM-DD dates (inclusive), from Meta.
 * `end` is sent as the next day's 00:00 UTC so the final day is counted.
 */
export async function getTemplateSpend(startDate: string, endDate: string): Promise<TemplateSpendReport> {
  const token = process.env.WHATSAPP_TOKEN;
  const waba = process.env.WHATSAPP_WABA_ID;
  if (!token || !waba) return { rows: [], total: 0, error: 'WhatsApp is not configured on the server.' };

  // 1) Every template, id → name/category.
  const tr = await fetch(`${GRAPH}/${waba}/message_templates?fields=id,name,category&limit=500&access_token=${token}`);
  const tj: any = await tr.json().catch(() => ({}));
  if (tj.error) return { rows: [], total: 0, error: tj.error.message || 'Could not list templates.' };
  const templates: { id: string; name: string; category: string | null }[] =
    (tj.data || []).map((t: any) => ({ id: String(t.id), name: t.name, category: t.category ?? null }));
  if (!templates.length) return { rows: [], total: 0 };

  const toUnix = (d: string, addDays = 0) =>
    Math.floor(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + addDays) / 1000);
  const start = toUnix(startDate);
  const end = toUnix(endDate, 1);

  const byId = new Map<string, TemplateSpendRow>();
  for (const t of templates) byId.set(t.id, { templateId: t.id, name: t.name, category: t.category, sent: 0, delivered: 0, amountSpent: 0 });

  // 2) template_analytics — 10 ids per request (Meta's cap).
  for (let i = 0; i < templates.length; i += 10) {
    const ids = templates.slice(i, i + 10).map((t) => t.id);
    const url = `${GRAPH}/${waba}/template_analytics?granularity=DAILY&start=${start}&end=${end}`
      + `&metric_types=COST,SENT,DELIVERED&template_ids=${ids.join(',')}&access_token=${token}`;
    const r = await fetch(url);
    const j: any = await r.json().catch(() => ({}));
    if (j.error) return { rows: [], total: 0, error: j.error.error_user_msg || j.error.message || 'Could not load spend from Meta.' };
    for (const series of (j.data || [])) {
      for (const dp of (series.data_points || [])) {
        const row = byId.get(String(dp.template_id));
        if (!row) continue;
        row.sent += Number(dp.sent || 0);
        row.delivered += Number(dp.delivered || 0);
        const spent = Array.isArray(dp.cost) ? (dp.cost.find((c: any) => c.type === 'amount_spent')?.value ?? 0) : 0;
        row.amountSpent += Number(spent || 0);
      }
    }
  }

  const rows = Array.from(byId.values())
    .filter((r) => r.sent > 0 || r.amountSpent > 0)
    .sort((a, b) => b.amountSpent - a.amountSpent);
  const total = rows.reduce((s, r) => s + r.amountSpent, 0);
  return { rows, total };
}

/** Upload a PNG to the WhatsApp media store; returns the media id used in a send. */
export async function uploadWhatsAppMedia(png: Buffer): Promise<string> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) throw new Error('WhatsApp not configured');

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', 'image/png');
  form.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'attendance.png');

  const res = await fetch(`${GRAPH}/${phoneId}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok || !j.id) throw new Error(`media upload failed: ${res.status} ${JSON.stringify(j)}`);
  return j.id as string;
}

/**
 * Generic: send an image-header template with N body text variables.
 */
export async function sendImageTemplate(opts: {
  to: string;
  templateName: string;
  lang?: string;
  mediaId: string;
  bodyParams: string[];
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) return { ok: false, error: 'WhatsApp not configured' };
  const body = {
    messaging_product: 'whatsapp',
    to: opts.to,
    type: 'template',
    template: {
      name: opts.templateName,
      language: { code: opts.lang || 'en' },
      components: [
        { type: 'header', parameters: [{ type: 'image', image: { id: opts.mediaId } }] },
        { type: 'body', parameters: opts.bodyParams.map((t) => ({ type: 'text', text: waSafeParam(t) })) },
      ],
    },
  };
  const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: `${res.status} ${JSON.stringify(j?.error || j)}` };
  return { ok: true, id: j?.messages?.[0]?.id };
}

/**
 * Send the attendance template to one recipient.
 * Template must have: image header, body with {{1}}=name, {{2}}=month label.
 */
export async function sendAttendanceTemplate(opts: {
  to: string;             // wa number (country code, digits)
  name: string;           // {{1}}
  monthLabel: string;     // {{2}} e.g. "July 2026"
  mediaId: string;        // uploaded image
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) return { ok: false, error: 'WhatsApp not configured' };
  const template = process.env.WHATSAPP_TEMPLATE_NAME || 'weekly_attendance_report';
  const lang = process.env.WHATSAPP_TEMPLATE_LANG || 'en';

  const body = {
    messaging_product: 'whatsapp',
    to: opts.to,
    type: 'template',
    template: {
      name: template,
      language: { code: lang },
      components: [
        { type: 'header', parameters: [{ type: 'image', image: { id: opts.mediaId } }] },
        { type: 'body', parameters: [
          { type: 'text', text: opts.name },
          { type: 'text', text: opts.monthLabel },
        ] },
      ],
    },
  };

  const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: `${res.status} ${JSON.stringify(j?.error || j)}` };
  return { ok: true, id: j?.messages?.[0]?.id };
}
