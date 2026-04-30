/**
 * Copies compiled workspace packages into a flat node_modules/ directory
 * so that @yao-pkg/pkg can resolve inter-package require() calls.
 *
 * Run this before `pkg` in the package:windows pipeline.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PACKAGES_DIR = path.join(ROOT, 'packages');
const DIST_NM = path.join(ROOT, 'dist', 'node_modules', '@codex-mobile-bridge');

// Source packages and their build output directories
const SOURCES = [
  { name: 'codex-rpc', dir: path.join(PACKAGES_DIR, 'codex-rpc') },
  { name: 'codex-adapter', dir: path.join(PACKAGES_DIR, 'codex-adapter') },
  { name: 'mobile-core', dir: path.join(PACKAGES_DIR, 'mobile-core') },
  { name: 'security', dir: path.join(PACKAGES_DIR, 'security') },
  { name: 'store', dir: path.join(PACKAGES_DIR, 'store') },
  { name: 'telegram', dir: path.join(PACKAGES_DIR, 'telegram') },
];

fs.mkdirSync(DIST_NM, { recursive: true });

for (const src of SOURCES) {
  const distDir = path.join(src.dir, 'dist');
  if (!fs.existsSync(distDir)) {
    console.warn(`  skip ${src.name}: dist/ not found`);
    continue;
  }
  const dest = path.join(DIST_NM, src.name);
  fs.cpSync(distDir, dest, { recursive: true });
  // Copy package.json so pkg can resolve the package
  const pkgJson = path.join(src.dir, 'package.json');
  if (fs.existsSync(pkgJson)) {
    fs.copyFileSync(pkgJson, path.join(dest, 'package.json'));
  }
  console.log(`  bundled ${src.name}`);
}

// Copy better-sqlite3 native addon into dist/node_modules
// so that pkg can include it in the snapshot for the bindings loader.
// Prefer the staged Node 20 ABI .node from rebuild-native if available,
// otherwise fall back to the local build (works in CI where local Node matches pkg target).
const bsqlDir = path.join(ROOT, 'node_modules', 'better-sqlite3');
const bsqlDest = path.join(ROOT, 'dist', 'node_modules', 'better-sqlite3');
const bsqlNodeDest = path.join(bsqlDest, 'build', 'Release');
const stagedNode = path.join(ROOT, 'dist', 'native-staging', 'better_sqlite3.node');
const localNode = path.join(bsqlDir, 'build', 'Release', 'better_sqlite3.node');
const bsqlNodeSrc = fs.existsSync(stagedNode) ? stagedNode : localNode;

if (fs.existsSync(bsqlNodeSrc)) {
  fs.mkdirSync(bsqlNodeDest, { recursive: true });
  fs.copyFileSync(bsqlNodeSrc, path.join(bsqlNodeDest, 'better_sqlite3.node'));
  fs.copyFileSync(
    path.join(bsqlDir, 'package.json'),
    path.join(bsqlDest, 'package.json')
  );
  console.log(`  bundled better-sqlite3 native addon${fs.existsSync(stagedNode) ? ' (staged Node 20 ABI)' : ''}`);
} else {
  console.warn('  skip better-sqlite3: .node file not found (run rebuild-native first)');
}

console.log('bundle-deps: done');
