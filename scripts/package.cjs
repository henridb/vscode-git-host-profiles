const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'artifacts');
fs.mkdirSync(artifacts, { recursive: true });
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const destination = path.join(artifacts, manifest.name + '-' + manifest.version + '.vsix');
const result = spawnSync(process.execPath, [
  require.resolve('@vscode/vsce/vsce'), 'package', '--no-dependencies', '--out', destination,
], { cwd: root, stdio: 'inherit', windowsHide: true });
process.exitCode = result.status ?? 1;
