// WhatsApp Cloud API (Meta) — media upload + template send.
// Used by the weekly attendance-report cron to deliver each staff member's
// monthly calendar image. Config comes from env (set on the VM .env):
//   WHATSAPP_TOKEN            — permanent System User access token
//   WHATSAPP_PHONE_NUMBER_ID  — the sending number's Phone Number ID
//   WHATSAPP_TEMPLATE_NAME    — approved template (default: weekly_attendance_report)
//   WHATSAPP_TEMPLATE_LANG    — template language code (default: en)

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

function bodyExample(body: string) {
  const n = (body.match(/\{\{\d+\}\}/g) || []).length;
  if (!n) return undefined;
  return { body_text: [Array.from({ length: n }, (_, i) => `Sample ${i + 1}`)] };
}

/**
 * Create an image-header template. `sample` is a representative PNG (the app
 * supplies one so the user needn't upload). Returns the initial review status.
 */
export async function createImageTemplate(opts: {
  name: string; category: 'UTILITY' | 'MARKETING'; body: string; footer?: string; sample: Buffer;
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
    { type: 'BODY', text: opts.body, ...(bodyExample(opts.body) ? { example: bodyExample(opts.body) } : {}) },
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
  name: string; category: 'UTILITY' | 'MARKETING'; body: string; footer?: string;
}): Promise<{ ok: boolean; status?: string; id?: string; error?: string }> {
  const token = process.env.WHATSAPP_TOKEN;
  const waba = process.env.WHATSAPP_WABA_ID;
  if (!token || !waba) return { ok: false, error: 'WhatsApp not fully configured (need token, WABA id)' };
  const components: any[] = [{ type: 'BODY', text: opts.body, ...(bodyExample(opts.body) ? { example: bodyExample(opts.body) } : {}) }];
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
      components: opts.bodyParams.length ? [{ type: 'body', parameters: opts.bodyParams.map((t) => ({ type: 'text', text: t })) }] : [],
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
        { type: 'body', parameters: opts.bodyParams.map((t) => ({ type: 'text', text: t })) },
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
