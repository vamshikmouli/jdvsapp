// SalaryBox BS-52 (S62) cloud protocol — JSON over WebSocket on :7792/pub/chat.
// Device -> reg; server acks; device -> sendlog (punches); server acks.
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.argv[2] || 7792);
const CAP = path.join(__dirname, 'captures');
fs.mkdirSync(CAP, { recursive: true });
const LOG = path.join(CAP, `ws-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
function log(s) { const l = `[${new Date().toISOString()}] ${s}`; console.log(l); fs.appendFileSync(LOG, l + '\n'); }
function nowIST() { return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' '); }

const wss = new WebSocket.Server({ port: PORT }, () => log(`WS server on ${PORT}`));

wss.on('connection', (ws, req) => {
  log(`CONNECTED ${req.socket.remoteAddress} url=${req.url}`);
  const send = (o) => { const s = JSON.stringify(o); ws.send(s); log(`SENT: ${s}`); };

  ws.on('message', (data) => {
    const text = data.toString('utf8');
    let msg; try { msg = JSON.parse(text); } catch { log(`RECV (non-json): ${text}`); return; }
    log(`RECV cmd=${msg.cmd || msg.ret}: ${text.slice(0, 400)}`);

    if (msg.cmd === 'reg') {
      send({ ret: 'reg', result: true, cloudtime: nowIST(), nosenduser: true });
      // Pull any logs the device already has queued.
      send({ cmd: 'getalllog', stn: true, from: '2020-01-01 00:00:00', to: '2030-01-01 00:00:00' });
    } else if (msg.cmd === 'sendlog') {
      log(`*** PUNCH RECORDS: ${JSON.stringify(msg.record)}`);
      send({ ret: 'sendlog', result: true, count: msg.count || 0, logindex: msg.logindex || 0, cloudtime: nowIST() });
    } else if (msg.cmd === 'senduser') {
      send({ ret: 'senduser', result: true, cloudtime: nowIST() });
    } else if (msg.ret === 'getalllog') {
      log(`getalllog result: ${text.slice(0, 400)}`);
    } else if (msg.cmd) {
      send({ ret: msg.cmd, result: true, cloudtime: nowIST() });
    }
  });
  ws.on('close', () => log('CLOSED'));
  ws.on('error', (e) => log(`WS ERR ${e.message}`));
});
