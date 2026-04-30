/**
 * Downloads native addons compiled for the pkg target ABI (Node 20, ABI 115).
 *
 * On a developer machine running Node 24, `npm install` compiles
 * better-sqlite3 for ABI 137. This script downloads the Node 20 prebuilt
 * to a staging directory (dist/native-staging/) so that bundle-deps.js
 * can copy it into dist/node_modules/ for pkg.
 *
 * The original node_modules/ .node file is NOT touched, keeping dev/test
 * working under the local Node version.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const PKG_TARGET_NODE = '20.0.0';
const PKG_ARCH = 'x64';
const PKG_PLATFORM = 'win32';

const ROOT = path.resolve(__dirname, '..');
const STAGING = path.join(ROOT, 'dist', 'native-staging');

const addons = [
  {
    name: 'better-sqlite3',
    pkgDir: path.join(ROOT, 'node_modules', 'better-sqlite3'),
    stageName: 'better_sqlite3.node',
  },
];

fs.mkdirSync(STAGING, { recursive: true });

for (const addon of addons) {
  if (!fs.existsSync(addon.pkgDir)) {
    console.warn(`  skip ${addon.name}: not installed`);
    continue;
  }

  console.log(`  Downloading ${addon.name} for node${PKG_TARGET_NODE}-${PKG_PLATFORM}-${PKG_ARCH}...`);

  // Create a clean workspace for prebuild-install
  const workDir = path.join(STAGING, addon.name);
  if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });

  // Copy binding.js and package.json so prebuild-install can resolve the package
  const libDir = path.join(workDir, 'lib');
  fs.mkdirSync(libDir, { recursive: true });
  fs.copyFileSync(
    path.join(addon.pkgDir, 'lib', 'database.js'),
    path.join(libDir, 'database.js')
  );
  fs.copyFileSync(
    path.join(addon.pkgDir, 'package.json'),
    path.join(workDir, 'package.json')
  );

  try {
    execSync(
      `npx prebuild-install --runtime node --target ${PKG_TARGET_NODE} --arch ${PKG_ARCH} --platform ${PKG_PLATFORM}`,
      { cwd: workDir, stdio: 'inherit' }
    );
    console.log(`  ${addon.name}: prebuilt downloaded`);
  } catch {
    console.log(`  ${addon.name}: prebuild-install failed, trying node-gyp rebuild...`);
    // Copy full source for node-gyp build
    fs.cpSync(
      path.join(addon.pkgDir, 'src'),
      path.join(workDir, 'src'),
      { recursive: true }
    );
    fs.cpSync(
      path.join(addon.pkgDir, 'deps'),
      path.join(workDir, 'deps'),
      { recursive: true }
    );
    fs.copyFileSync(
      path.join(addon.pkgDir, 'binding.gyp'),
      path.join(workDir, 'binding.gyp')
    );
    execSync(
      `npx node-gyp rebuild --release --target=${PKG_TARGET_NODE} --target_arch=${PKG_ARCH} --dist-url=https://nodejs.org/dist`,
      { cwd: workDir, stdio: 'inherit' }
    );
    console.log(`  ${addon.name}: built from source`);
  }

  // Copy the built .node file to staging root
  const builtNode = path.join(workDir, 'build', 'Release', 'better_sqlite3.node');
  const stagedNode = path.join(STAGING, addon.stageName);
  if (!fs.existsSync(builtNode)) {
    console.error(`FATAL: ${addon.name} .node not found at ${builtNode}`);
    process.exit(1);
  }
  fs.copyFileSync(builtNode, stagedNode);

  const size = fs.statSync(stagedNode).size;
  console.log(`  staged ${addon.stageName}: ${(size / 1024 / 1024).toFixed(2)} MB`);
}

console.log('rebuild-native: done');
