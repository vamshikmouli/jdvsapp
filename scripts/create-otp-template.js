#!/usr/bin/env node
/**
 * Create the WhatsApp AUTHENTICATION template `login_otp` for first-login OTP.
 *
 * Authentication templates are the ONLY category Meta allows for verification
 * codes (a free-text UTILITY template with an OTP gets rejected). Their body is
 * fixed — "{{1}} is your verification code." — so we don't send body text; we
 * only toggle the security line, the expiry footer, and a Copy-code button.
 *
 * Run ON THE VM (where the WhatsApp token lives), from the app directory:
 *     node scripts/create-otp-template.js
 *
 * Reads from process.env, falling back to ./.env then ./.env.local:
 *   WHATSAPP_TOKEN            (required) — System User access token
 *   WHATSAPP_WABA_ID          (required) — WhatsApp Business Account id
 *   WHATSAPP_TEMPLATE_LANG    (optional, default "en") — must match what the app sends
 *   WHATSAPP_OTP_TEMPLATE_NAME(optional, default "login_otp")
 */
const fs = require('fs');
const path = require('path');

function loadEnvFile(file) {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim().replace(/^["']|["']$/g, '');
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch { /* file absent — fine */ }
}

// process.env wins; then .env; then .env.local
loadEnvFile(path.resolve(process.cwd(), '.env'));
loadEnvFile(path.resolve(process.cwd(), '.env.local'));

const TOKEN = process.env.WHATSAPP_TOKEN;
const WABA = process.env.WHATSAPP_WABA_ID;
const LANG = process.env.WHATSAPP_TEMPLATE_LANG || 'en';
const NAME = process.env.WHATSAPP_OTP_TEMPLATE_NAME || 'login_otp';

if (!TOKEN || !WABA) {
  console.error('❌ Missing WHATSAPP_TOKEN and/or WHATSAPP_WABA_ID in the environment (.env).');
  process.exit(1);
}

const payload = {
  name: NAME,
  language: LANG,
  category: 'AUTHENTICATION',
  components: [
    // Fixed body "{{1}} is your verification code." + the security recommendation line.
    { type: 'BODY', add_security_recommendation: true },
    // "This code expires in 5 minutes." — keep in sync with OTP_TTL_MIN (default 5).
    { type: 'FOOTER', code_expiration_minutes: 5 },
    // Copy-code button (works on web). One-tap autofill is Android-app only.
    { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: 'Copy code' }] },
  ],
};

(async () => {
  const url = `https://graph.facebook.com/v21.0/${WABA}/message_templates`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) {
    console.error(`❌ Create failed (${res.status}):`, j.error ? (j.error.error_user_msg || j.error.message) : JSON.stringify(j));
    process.exit(1);
  }
  console.log(`✅ Template "${NAME}" (${LANG}) submitted.`);
  console.log(`   id: ${j.id}   status: ${j.status || 'PENDING'} (${j.category || 'AUTHENTICATION'})`);
  console.log('   Authentication templates are usually auto-approved within minutes.');
})().catch((e) => { console.error('❌ Request error:', e.message); process.exit(1); });
