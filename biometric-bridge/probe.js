const ZKLib = require('node-zklib');

(async () => {
  const zk = new ZKLib('192.168.1.16', 5005, 10000, 4000);
  try {
    await zk.createSocket();
    console.log('CONNECTED to 192.168.1.16:5005');

    try { const info = await zk.getInfo(); console.log('INFO:', JSON.stringify(info)); }
    catch (e) { console.log('getInfo err:', e.message); }

    try {
      const users = await zk.getUsers();
      const list = users?.data || users || [];
      console.log(`USERS: ${list.length}`);
      console.log(JSON.stringify(list.slice(0, 8), null, 2));
    } catch (e) { console.log('getUsers err:', e.message); }

    try {
      const logs = await zk.getAttendances();
      const list = logs?.data || logs || [];
      console.log(`ATTENDANCE LOGS: ${list.length}`);
      console.log(JSON.stringify(list.slice(-8), null, 2));
    } catch (e) { console.log('getAttendances err:', e.message); }

    await zk.disconnect();
  } catch (e) {
    console.log('CONNECT FAILED:', e.message);
    try { await zk.disconnect(); } catch {}
  }
})();
