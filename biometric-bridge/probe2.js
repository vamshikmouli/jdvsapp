const util = require('util');
const ZKLib = require('node-zklib');

async function tryConn(port, label) {
  const zk = new ZKLib('192.168.1.16', port, 8000, 4000);
  try {
    await zk.createSocket();
    console.log(`[${label} :${port}] CONNECTED`);
    try { console.log(`  INFO:`, JSON.stringify(await zk.getInfo())); } catch (e) { console.log('  getInfo err:', e && (e.message||util.inspect(e))); }
    try { const u = await zk.getUsers(); console.log(`  USERS: ${(u?.data||[]).length}`, JSON.stringify((u?.data||[]).slice(0,5))); } catch (e) { console.log('  users err:', e && (e.message||util.inspect(e))); }
    try { const a = await zk.getAttendances(); const d=a?.data||[]; console.log(`  LOGS: ${d.length}`, JSON.stringify(d.slice(-5))); } catch (e) { console.log('  logs err:', e && (e.message||util.inspect(e))); }
    await zk.disconnect();
    return true;
  } catch (e) {
    console.log(`[${label} :${port}] FAILED:`, util.inspect(e, {depth: 2}).slice(0, 300));
    try { await zk.disconnect(); } catch {}
    return false;
  }
}

(async () => {
  await tryConn(4370, 'std');
  await tryConn(5005, 'ethport');
  process.exit(0);
})();
