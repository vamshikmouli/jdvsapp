// Raw TCP capture listener for the SalaryBox/S62FP biometric device.
// The device "Server mode" pushes punches to Server IP:Port (default 7792).
// Point the device's Server IP at this machine's LAN IP and keep/match the port.
// This script just DUMPS whatever arrives so we can decode the protocol.

const net = require("net");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.argv[2] || 7792);
const HOST = "0.0.0.0";

const CAP_DIR = path.join(__dirname, "captures");
fs.mkdirSync(CAP_DIR, { recursive: true });

function ts() {
  return new Date().toISOString();
}

// Append raw bytes (base64) + hexdump to a per-run log so we never lose a punch.
const LOG_FILE = path.join(CAP_DIR, `capture-${ts().replace(/[:.]/g, "-")}.log`);
function save(who, data) {
  fs.appendFileSync(
    LOG_FILE,
    `\n[${ts()}] ${data.length} bytes from ${who}\n` +
      `BASE64: ${data.toString("base64")}\n` +
      hexdump(data) + "\n" +
      `TEXT: ${JSON.stringify(data.toString("latin1"))}\n`
  );
}

function hexdump(buf) {
  const lines = [];
  for (let i = 0; i < buf.length; i += 16) {
    const slice = buf.subarray(i, i + 16);
    const hex = [...slice].map((b) => b.toString(16).padStart(2, "0")).join(" ");
    const ascii = [...slice]
      .map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : "."))
      .join("");
    lines.push(`  ${i.toString(16).padStart(4, "0")}  ${hex.padEnd(48)}  ${ascii}`);
  }
  return lines.join("\n");
}

const server = net.createServer((socket) => {
  const who = `${socket.remoteAddress}:${socket.remotePort}`;
  console.log(`\n[${ts()}] >>> CONNECTED from ${who}`);

  socket.on("data", (data) => {
    console.log(`\n[${ts()}] <<< ${data.length} bytes from ${who}`);
    console.log(hexdump(data));
    console.log(`  TEXT: ${JSON.stringify(data.toString("latin1"))}`);
    save(who, data);
    // Send a couple of common ACK styles in case the device waits for one.
    // (Harmless if ignored; helps the device consider the push delivered.)
    try {
      socket.write("OK\r\n");
    } catch {}
  });

  socket.on("close", () => console.log(`[${ts()}] xxx CLOSED ${who}`));
  socket.on("error", (e) => console.log(`[${ts()}] !!! ERROR ${who}: ${e.message}`));
});

server.on("error", (e) => {
  console.error(`Listener error: ${e.message}`);
  if (e.code === "EADDRINUSE") console.error(`Port ${PORT} already in use.`);
});

server.listen(PORT, HOST, () => {
  console.log(`[${ts()}] Capture listener on ${HOST}:${PORT}`);
  console.log(`Set the device's Server IP to this machine and Port to ${PORT}, then punch.`);
});
