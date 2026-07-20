// Production bridge for the SalaryBox BS-52 (S62) biometric terminal.
// The device connects here as a WebSocket client (ws://<this-host>:7792/pub/chat)
// and streams punches as JSON. We ack its protocol and forward each punch to the
// app's ingest endpoint, which maps enrollid -> staff and records the punch.
//
// Protocol (decoded 2026-07-18):
//   device -> {"cmd":"reg","sn":...,"devinfo":{...}}      server -> {"ret":"reg","result":true,...}
//   device -> {"cmd":"sendlog","record":[{enrollid,time,inout,...}]}
//   server -> {"ret":"sendlog","result":true,...}   (must ack or the device re-sends)
//
// Env: BRIDGE_PORT (7792), APP_URL (http://127.0.0.1:3000), CRON_SECRET (shared with the app).
const WebSocket = require('ws');

const PORT = Number(process.env.BRIDGE_PORT || 7792);
const APP_URL = (process.env.APP_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const SECRET = process.env.CRON_SECRET || '';

function log(...a) { console.log(`[${new Date().toISOString()}]`, ...a); }
function nowIST() { return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' '); }

async function forwardPunch(rec, sn) {
  try {
    const res = await fetch(`${APP_URL}/api/staff-attendance/bridge/punch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ enrollid: rec.enrollid, time: rec.time, inout: rec.inout, sn }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return log(`  -> ingest HTTP ${res.status}`, JSON.stringify(j));
    if (j.skipped === 'unmapped') return log(`  -> enrollid ${rec.enrollid} NOT MAPPED to any staff`);
    if (j.duplicate) return log(`  -> duplicate, ignored (${j.staff})`);
    log(`  -> recorded ${j.type} for ${j.staff} (day: ${j.status})`);
  } catch (e) {
    log('  -> ingest failed:', e.message);
  }
}

const wss = new WebSocket.Server({ port: PORT }, () => log(`bridge listening on :${PORT} -> ${APP_URL}`));

wss.on('connection', (ws, req) => {
  log(`device connected from ${req.socket.remoteAddress} ${req.url}`);
  const send = (o) => ws.send(JSON.stringify(o));

  ws.on('message', async (data) => {
    let msg;
    try { msg = JSON.parse(data.toString('utf8')); } catch { return; }

    if (msg.cmd === 'reg') {
      log(`registered: sn=${msg.sn} model=${msg.devinfo?.modelname} newlogs=${msg.devinfo?.usednewlog}`);
      send({ ret: 'reg', result: true, cloudtime: nowIST(), nosenduser: true });
    } else if (msg.cmd === 'sendlog') {
      const records = Array.isArray(msg.record) ? msg.record : [];
      log(`punch batch: ${records.length} record(s)`);
      for (const r of records) {
        log(`  enrollid=${r.enrollid} time=${r.time} inout=${r.inout}`);
        await forwardPunch(r, msg.sn);
      }
      // Ack so the device marks them delivered and stops re-sending.
      send({ ret: 'sendlog', result: true, count: msg.count || records.length, logindex: msg.logindex || 0, cloudtime: nowIST() });
    } else if (msg.ret === 'getalllog') {
      const records = Array.isArray(msg.record) ? msg.record : [];
      log(`history: ${records.length} record(s)`);
      for (const r of records) await forwardPunch(r, msg.sn);
    } else if (msg.cmd) {
      send({ ret: msg.cmd, result: true, cloudtime: nowIST() });
    }
  });

  ws.on('close', () => log('device disconnected'));
  ws.on('error', (e) => log('ws error:', e.message));
});

wss.on('error', (e) => log('server error:', e.message));
