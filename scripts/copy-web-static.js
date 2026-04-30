const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const webSrc = path.join(repoRoot, 'apps', 'web', 'src');
const webDist = path.join(repoRoot, 'apps', 'web', 'dist');
const staticFiles = ['index.html', 'style.css', 'manifest.json'];

fs.mkdirSync(webDist, { recursive: true });

for (const file of staticFiles) {
  fs.copyFileSync(path.join(webSrc, file), path.join(webDist, file));
  console.log(`copied ${file}`);
}
