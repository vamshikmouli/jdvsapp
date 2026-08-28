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

// Over Wi-Fi this terminal's own "push on punch" logic can silently stall —
// the connection stays open (TCP-alive) but it stops sending anything until a
// reboot. Rather than trust it to push, proactively pull the full log on a
// timer over every open connection. Duplicates are cheap (dedup on staff+at).
const POLL_MS = 3 * 60 * 1000;
const activeConns = new Set();
setInterval(() => {
  for (const ws of activeConns) {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ cmd: 'getalllog', stn: true, from: '2020-01-01 00:00:00', to: '2030-01-01 00:00:00' })); }
      catch (e) { log('poll send failed:', e.message); }
    }
  }
}, POLL_MS);

wss.on('connection', (ws, req) => {
  log(`device connected from ${req.socket.remoteAddress} ${req.url}`);
  activeConns.add(ws);
  const send = (o) => ws.send(JSON.stringify(o));

  ws.on('message', async (data) => {
    let msg;
    try { msg = JSON.parse(data.toString('utf8')); } catch { return; }

    // One-shot operator command: fire on any inbound message while connected.
        try {
          const P = '/home/ubuntu/jdvsapp/biometric-bridge/pending-cmd.json';
          if (require('fs').existsSync(P)) {
            const payload = JSON.parse(require('fs').readFileSync(P, 'utf8'));
            send(payload);
            log('PENDING-CMD SENT: ' + JSON.stringify(payload).slice(0, 200));
            require('fs').renameSync(P, P + '.sent-' + Date.now());
          }
        } catch (e) { log('pending-cmd error: ' + e.message); }
    
        if (msg.cmd === 'senduser') {
          try { require('fs').appendFileSync('/home/ubuntu/jdvsapp/biometric-bridge/users-capture.jsonl', JSON.stringify(msg) + String.fromCharCode(10)); } catch (e) {}
        }
        if (msg.cmd !== 'sendlog' && msg.ret !== 'getalllog') log('RAW: ' + JSON.stringify(msg).slice(0,300));

    if (msg.cmd === 'reg') {
      log(`registered: sn=${msg.sn} model=${msg.devinfo?.modelname} newlogs=${msg.devinfo?.usednewlog}`);
      send({ ret: 'reg', result: true, cloudtime: nowIST(), nosenduser: false });
      // Don't rely on the device's own "new logs" bookkeeping (it can miss
      // punches after a rough reconnect) — pull the full log every time it
      // checks in. Duplicates are cheap: /bridge/punch dedupes on (staff, at).
      send({ cmd: 'getalllog', stn: true, from: '2020-01-01 00:00:00', to: '2030-01-01 00:00:00' });
      send({ cmd: "getalluser", stn: true });
      // One-shot: if an operator dropped a command file, send it once then retire it.
      try {
        const P = "/home/ubuntu/jdvsapp/biometric-bridge/pending-cmd.json";
        if (require("fs").existsSync(P)) {
          const payload = JSON.parse(require("fs").readFileSync(P, "utf8"));
          send(payload);
          log("PENDING-CMD SENT: " + JSON.stringify(payload).slice(0, 200));
          require("fs").renameSync(P, P + ".sent-" + Date.now());
        }
      } catch (e) { log("pending-cmd error: " + e.message); }
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

  ws.on('close', () => { log('device disconnected'); activeConns.delete(ws); });
  ws.on('error', (e) => log('ws error:', e.message));
});

wss.on('error', (e) => log('server error:', e.message));
