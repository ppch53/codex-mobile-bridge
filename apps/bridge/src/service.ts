import fs from 'fs';
import path from 'path';
import { main } from './main';

const appData = process.env.APPDATA || process.env.HOME || '.';
const localAppData = process.env.LOCALAPPDATA || appData;
const dataDir = process.env.BRIDGE_DATA_DIR || path.join(appData, 'CodexMobileBridge');
const logDir = process.env.BRIDGE_LOG_DIR || path.join(localAppData, 'CodexMobileBridge', 'logs');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

// Write PID file for service management
const pidPath = path.join(dataDir, 'bridge.pid');
fs.writeFileSync(pidPath, String(process.pid), 'utf-8');

// Log uncaught exceptions to disk so they survive service restarts
process.on('uncaughtException', (err) => {
  const logPath = path.join(logDir, 'service-crash.log');
  const entry = `[${new Date().toISOString()}] uncaughtException: ${err.stack || err.message}\n`;
  try { fs.appendFileSync(logPath, entry); } catch { /* best-effort */ }
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const logPath = path.join(logDir, 'service-crash.log');
  const entry = `[${new Date().toISOString()}] unhandledRejection: ${reason}\n`;
  try { fs.appendFileSync(logPath, entry); } catch { /* best-effort */ }
});

main()
  .catch((err) => {
    const logPath = path.join(logDir, 'service-crash.log');
    const entry = `[${new Date().toISOString()}] fatal: ${err.stack || err.message}\n`;
    try { fs.appendFileSync(logPath, entry); } catch { /* best-effort */ }
    process.exit(1);
  })
  .finally(() => {
    try { fs.unlinkSync(pidPath); } catch { /* already removed */ }
  });
