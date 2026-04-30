const net = require('net');

const PORTS = [4500, 9234, 9235, 9236, 9237];
const HOST = '127.0.0.1';
const TIMEOUT = 500;

function probe(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: HOST, port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.setTimeout(TIMEOUT);
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.on('error', () => { socket.destroy(); resolve(false); });
  });
}

async function main() {
  console.log(`Probing ${HOST} on ports: ${PORTS.join(', ')}`);
  console.log('');

  let found = false;
  for (const port of PORTS) {
    const ok = await probe(port);
    const status = ok ? 'OPEN' : 'closed';
    console.log(`  Port ${port}: ${status}`);
    if (ok) found = true;
  }

  console.log('');
  if (found) {
    console.log('Codex app-server detected. Use CODEX_TRANSPORT=websocket or auto.');
  } else {
    console.log('No Codex app-server found. The bridge will fall back to stdio mode.');
  }
}

main().catch(console.error);
