/**
 * Smoke test for the packaged executable.
 *
 * Launches dist/codex-mobile-bridge.exe with isolated temp dirs and
 * random ports, then validates:
 *   1. HTTP GET /api/status returns 200 { status: 'ok' }
 *   2. HTTP GET /index.html returns the Web/PWA shell
 *   3. POST /api/pairing/generate returns { code, deviceId }
 *   4. POST /api/pairing/verify with { code } returns { token }
 *   5. state.db exists in BRIDGE_DATA_DIR (SQLite works)
 *   6. service-crash.log has NO ABI / dlopen errors
 *
 * Exits 0 on pass, 1 on fail. No || true, no skipping checks.
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const net = require('net');

const EXE = path.resolve(__dirname, '..', 'dist', 'codex-mobile-bridge.exe');
const STARTUP_TIMEOUT_MS = 20_000;
const HTTP_TIMEOUT_MS = 5_000;

// --- helpers -----------------------------------------------------------

function randomPort() {
  return 20000 + Math.floor(Math.random() * 40000);
}

function waitForPort(port, host, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    (function attempt() {
      const sock = net.createConnection({ host, port });
      sock.once('connect', () => { sock.destroy(); resolve(); });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() < deadline) setTimeout(attempt, 300);
        else reject(new Error(`port ${port} not reachable within ${timeoutMs}ms`));
      });
    })();
  });
}

function httpRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1',
      port: httpPort,
      path: urlPath,
      method,
      headers: { 'Content-Type': 'application/json' },
      timeout: HTTP_TIMEOUT_MS,
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = null; }
        resolve({ status: res.statusCode, body: parsed, raw: data });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  return false;
}

// --- main --------------------------------------------------------------

if (!fs.existsSync(EXE)) {
  console.error(`FAIL: Packaged exe not found at ${EXE}`);
  process.exit(1);
}

const runId = Date.now();
const tmpBase = path.join(os.tmpdir(), `cxb-smoke-${runId}`);
const dataDir = path.join(tmpBase, 'data');
const logDir = path.join(tmpBase, 'logs');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(logDir, { recursive: true });

const httpPort = randomPort();
const wsPort = randomPort();
const crashLog = path.join(logDir, 'service-crash.log');

const env = {
  ...process.env,
  BRIDGE_DATA_DIR: dataDir,
  BRIDGE_LOG_DIR: logDir,
  HTTP_PORT: String(httpPort),
  WEB_PORT: String(wsPort),
  WEB_ENABLED: 'false',
  TELEGRAM_BOT_TOKEN: 'replace_me',
  CODEX_TRANSPORT: 'websocket',
  CODEX_WS_URL: 'ws://127.0.0.1:9',
};

console.log(`Smoke test: launching exe`);
console.log(`  exe:       ${EXE}`);
console.log(`  HTTP_PORT: ${httpPort}`);
console.log(`  WEB_PORT:  ${wsPort}`);
console.log(`  dataDir:   ${dataDir}`);
console.log(`  logDir:    ${logDir}`);

const child = spawn(EXE, [], {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

let stdout = '';
let stderr = '';
child.stdout.on('data', (d) => { stdout += d.toString(); });
child.stderr.on('data', (d) => { stderr += d.toString(); });

function killTree() {
  if (child.killed) return;
  try {
    // Windows: kill entire process tree
    execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: 'ignore' });
  } catch {
    try { child.kill('SIGTERM'); } catch { /* already dead */ }
  }
}

async function run() {
  let pass = true;

  // Wait for the HTTP server to come up
  try {
    await waitForPort(httpPort, '127.0.0.1', STARTUP_TIMEOUT_MS);
    console.log('  HTTP port is reachable');
  } catch (err) {
    pass = fail(`exe did not start listening on port ${httpPort}: ${err.message}`);
    // Still run crash-log check below
  }

  if (pass) {
    // CHECK 1: /api/status
    try {
      const r = await httpRequest('GET', '/api/status');
      if (r.status !== 200 || !r.body || r.body.status !== 'ok') {
        pass = fail(`/api/status returned ${r.status}: ${r.raw}`);
      } else {
        console.log('  CHECK PASS: /api/status -> 200 ok');
      }
    } catch (err) {
      pass = fail(`/api/status request failed: ${err.message}`);
    }
  }

  if (pass) {
    // CHECK 2: /index.html
    try {
      const r = await httpRequest('GET', '/index.html');
      if (r.status !== 200 || !r.raw.includes('Codex Mobile Bridge') || !r.raw.includes('/app.js')) {
        pass = fail(`/index.html returned ${r.status}: ${r.raw.slice(0, 300)}`);
      } else {
        console.log('  CHECK PASS: /index.html -> Web/PWA shell');
      }
    } catch (err) {
      pass = fail(`/index.html request failed: ${err.message}`);
    }
  }

  let pairingCode;
  let pairingDeviceId;

  if (pass) {
    // CHECK 3: /api/pairing/generate
    try {
      const r = await httpRequest('POST', '/api/pairing/generate', {});
      if (r.status !== 200 || !r.body || !r.body.code || !r.body.deviceId) {
        pass = fail(`/api/pairing/generate returned ${r.status}: ${r.raw}`);
      } else {
        pairingCode = r.body.code;
        pairingDeviceId = r.body.deviceId;
        console.log(`  CHECK PASS: /api/pairing/generate -> code=${pairingCode}, deviceId=${pairingDeviceId}`);
      }
    } catch (err) {
      pass = fail(`/api/pairing/generate request failed: ${err.message}`);
    }
  }

  if (pass) {
    // CHECK 4: /api/pairing/verify with { code }
    try {
      const r = await httpRequest('POST', '/api/pairing/verify', { code: pairingCode });
      if (r.status !== 200 || !r.body || !r.body.token) {
        pass = fail(`/api/pairing/verify returned ${r.status}: ${r.raw}`);
      } else if (r.body.token !== pairingDeviceId) {
        pass = fail(`/api/pairing/verify returned token that does not match generated deviceId`);
      } else {
        console.log(`  CHECK PASS: /api/pairing/verify -> token matches generated deviceId`);
      }
    } catch (err) {
      pass = fail(`/api/pairing/verify request failed: ${err.message}`);
    }
  }

  // Kill the exe now that HTTP checks are done
  killTree();

  // CHECK 5: state.db exists
  const dbPath = path.join(dataDir, 'state.db');
  if (!fs.existsSync(dbPath)) {
    pass = fail(`state.db not found at ${dbPath} — SQLite may have crashed`);
  } else {
    const dbSize = fs.statSync(dbPath).size;
    console.log(`  CHECK PASS: state.db exists (${dbSize} bytes)`);
  }

  // CHECK 6: crash log has NO fatal ABI errors
  if (fs.existsSync(crashLog)) {
    const content = fs.readFileSync(crashLog, 'utf-8');
    if (/NODE_MODULE_VERSION/.test(content)) {
      pass = fail('service-crash.log contains NODE_MODULE_VERSION ABI mismatch:\n' + content);
    }
    if (/Cannot find module.*better_sqlite3/.test(content)) {
      pass = fail('service-crash.log shows better_sqlite3 module not found:\n' + content);
    }
    if (/dlopen/.test(content) && /error/i.test(content)) {
      pass = fail('service-crash.log shows dlopen error:\n' + content);
    }
    if (pass && content.trim().length > 0) {
      console.log('  NOTE: service-crash.log has non-fatal content:');
      console.log('  ' + content.trim().split('\n').join('\n  '));
    }
  }
  if (pass) {
    console.log('  CHECK PASS: no ABI/dlopen errors in crash log');
  }

  // Cleanup temp dirs
  try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch { /* best-effort */ }

  if (pass) {
    console.log('\nPASS: Packaged exe smoke test passed');
    process.exit(0);
  } else {
    console.error('\nFAIL: Packaged exe smoke test failed');
    console.error('stdout:', stdout.slice(0, 3000));
    console.error('stderr:', stderr.slice(0, 3000));
    process.exit(1);
  }
}

// Give exe a moment to start or crash, then run checks
setTimeout(() => run().catch((err) => {
  console.error('FAIL: unexpected error:', err);
  killTree();
  process.exit(1);
}), 1500);
