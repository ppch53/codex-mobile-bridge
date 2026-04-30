const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const webDist = path.join(repoRoot, 'apps', 'web', 'dist');
const runtimeWeb = path.join(repoRoot, 'dist', 'web');

if (!fs.existsSync(path.join(webDist, 'index.html'))) {
  throw new Error(`Web build output not found at ${webDist}. Run npm run build -w apps/web first.`);
}

fs.rmSync(runtimeWeb, { recursive: true, force: true });
fs.cpSync(webDist, runtimeWeb, { recursive: true });
console.log(`staged web assets: ${runtimeWeb}`);
