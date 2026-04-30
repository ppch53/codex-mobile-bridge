const fs = require('fs');
const path = require('path');

const PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/g,
  /ghp_[a-zA-Z0-9]{36}/g,
  /xoxb-[a-zA-Z0-9-]+/g,
  /Bearer [A-Za-z0-9._-]{20,}/g,
  /api_key\s*=\s*[A-Za-z0-9._-]{10,}/gi,
  /password\s*=\s*[^\s&]{8,}/gi,
];

const EXCLUDE_DIRS = ['node_modules', 'dist', '.git'];
const EXCLUDE_FILES = ['.env.example'];
const EXCLUDE_PATTERNS = [/\.test\.ts$/, /\.spec\.ts$/, /Redactor\.ts$/];

function scanDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const findings = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!EXCLUDE_DIRS.includes(entry.name)) {
        findings.push(...scanDir(fullPath));
      }
      continue;
    }

    if (!/\.(ts|json|js)$/.test(entry.name)) continue;
    if (EXCLUDE_FILES.includes(entry.name)) continue;
    if (EXCLUDE_PATTERNS.some(p => p.test(entry.name))) continue;

    const content = fs.readFileSync(fullPath, 'utf8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      for (const pattern of PATTERNS) {
        pattern.lastIndex = 0;
        if (pattern.test(lines[i])) {
          findings.push({ file: fullPath, line: i + 1, content: lines[i].trim().slice(0, 100) });
        }
      }
    }
  }

  return findings;
}

console.log('Scanning for potential secrets...');
const findings = scanDir('.');

if (findings.length > 0) {
  console.error(`\nWARNING: Found ${findings.length} potential secret(s):\n`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}`);
    console.error(`    ${f.content}\n`);
  }
  process.exit(1);
} else {
  console.log('No potential secrets found.');
}
