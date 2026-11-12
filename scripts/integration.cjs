// Runs authored tests in an isolated VS Code instance, never in the user's profile.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { downloadAndUnzipVSCode } = require('@vscode/test-electron');

async function main() {
  const root = path.resolve(__dirname, '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const extensionId = manifest.publisher + '.' + manifest.name;
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'git-host-profiles-test-'));
  const userData = path.join(fixture, 'user-data');
  const project = path.join(fixture, 'gits', 'gh-example', 'new-repository');
  const user = path.join(userData, 'User');
  const hooks = path.join(fixture, 'empty-hooks');
  fs.mkdirSync(hooks);
  const write = (name, data) => {
    fs.mkdirSync(path.dirname(name), { recursive: true });
    fs.writeFileSync(name, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  };
  const git = (directory, ...args) => {
    const result = spawnSync('git', ['-c', 'core.hooksPath=' + hooks,
      '-c', 'commit.gpgsign=false', '-c', 'init.templateDir=' + hooks,
      '-C', directory, ...args], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) {
      throw new Error('Fixture git command failed: ' + result.stderr);
    }
  };
  fs.mkdirSync(project, { recursive: true });
  git(project, 'init', '--quiet');
  git(project, 'remote', 'add', 'origin', 'https://forge.example.org/team/repository.git');
  write(path.join(project, 'package.json'), { private: true });
  write(path.join(project, 'src', 'example.ts'), 'export const example = true;\n');
  // Create a real submodule entirely from local fixture data, then give it a
  // conflicting host. The test never clones from or contacts that host.
  const upstream = path.join(fixture, 'dependency-upstream');
  fs.mkdirSync(upstream);
  git(upstream, 'init', '--quiet');
  write(path.join(upstream, 'README.md'), '# Dependency fixture\n');
  git(upstream, 'add', 'README.md');
  git(upstream, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.org',
    'commit', '--quiet', '-m', 'Create dependency fixture');
  git(project, '-c', 'protocol.file.allow=always', 'submodule', 'add', '--quiet',
    upstream, 'vendor/library');
  git(path.join(project, 'vendor', 'library'), 'remote', 'set-url', 'origin',
    'https://other.example.org/team/library.git');
  // Workspace settings must never be allowed to choose a profile.
  write(path.join(project, '.vscode', 'settings.json'), {
    'gitHostProfiles.rules': [{ profile: 'Unwanted', folders: ['**'] }],
  });
  write(path.join(user, 'settings.json'), {
    'telemetry.telemetryLevel': 'off',
    'update.mode': 'none',
    'extensions.autoCheckUpdates': false,
    'extensions.autoUpdate': false,
    'workbench.enableExperiments': false,
    'chat.disableAIFeatures': true,
    'security.workspace.trust.enabled': false,
    'git.openRepositoryInParentFolders': 'always',
    'git.detectSubmodules': true,
    'gitHostProfiles.rules': [
      { profile: 'Example Forge', remoteHosts: ['forge.example.org'] },
      { profile: 'Example Folder', remoteHosts: ['other.example.org'] },
    ],
  });
  write(path.join(user, 'globalStorage', 'storage.json'), {
    userDataProfiles: [
      { name: 'Example Forge', location: 'example-forge', useDefaultFlags: { extensions: true } },
      { name: 'Example Folder', location: 'example-folder', useDefaultFlags: { extensions: true } },
    ],
  });
  write(path.join(user, 'profiles', 'example-forge', 'settings.json'), { 'editor.tabSize': 7 });
  write(path.join(user, 'profiles', 'example-folder', 'settings.json'), { 'editor.tabSize': 9 });
  const executable = process.env.VSCODE_EXECUTABLE_PATH ||
    await downloadAndUnzipVSCode(process.env.VSCODE_VERSION || 'stable');
  const resultPath = path.join(fixture, 'result.json');
  const installed = path.join(fixture, 'extensions');
  const runtime = path.join(installed, extensionId + '-' + manifest.version);
  fs.mkdirSync(runtime, { recursive: true });
  fs.copyFileSync(path.join(root, 'package.json'), path.join(runtime, 'package.json'));
  fs.cpSync(path.join(root, 'dist', 'src'), path.join(runtime, 'dist', 'src'), { recursive: true });
  const probe = path.join(installed, 'integration.git-host-profiles-test-probe-0.0.0');
  write(path.join(probe, 'package.json'), {
    name: 'git-host-profiles-test-probe', publisher: 'integration', version: '0.0.0',
    engines: { vscode: '^1.100.0' }, main: './main.js',
    activationEvents: ['onStartupFinished'],
  });
  write(path.join(probe, 'main.js'), fs.readFileSync(path.join(root, 'dist', 'test', 'integration.js'), 'utf8'));
  write(resultPath + '.phase', 'host');
  let workspace = project;
  if (process.env.GHP_TEST_MULTI_ROOT === '1') {
    const second = path.join(fixture, 'gits', 'gh-another', 'another-repository');
    fs.mkdirSync(path.join(second, 'src'), { recursive: true });
    git(second, 'init', '--quiet');
    git(second, 'remote', 'add', 'origin', 'https://forge.example.org/team/another.git');
    write(path.join(second, 'package.json'), { private: true });
    write(path.join(second, 'src', 'example.ts'), 'export const example = true;\n');
    workspace = path.join(fixture, 'example.code-workspace');
    write(workspace, { folders: [{ path: project }, { path: second }] });
  }
  const env = { ...process.env, GHP_TEST_RESULT: resultPath, GHP_TEST_EXTENSION_ID: extensionId };
  delete env.ELECTRON_RUN_AS_NODE;
  const args = [
    workspace,
    '--new-window',
    '--user-data-dir=' + userData,
    '--extensions-dir=' + path.join(fixture, 'extensions'),
    '--shared-data-dir=' + path.join(fixture, 'shared-data'),
    '--disable-updates',
    '--skip-welcome',
    '--skip-release-notes',
    '--disable-workspace-trust',
  ];
  if (process.platform === 'linux' && process.getuid?.() === 0) {
    args.push('--no-sandbox');
  }
  console.log('Isolated VS Code fixture: ' + fixture);
  await new Promise((resolve, reject) => {
    const log = fs.createWriteStream(path.join(fixture, 'vscode.log'));
    const child = spawn(executable, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('VS Code integration tests timed out after 90 seconds. Fixture retained: ' + fixture));
    }, 90_000);
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('exit', code => {
      clearTimeout(timeout);
      log.end();
      code === 0 ? resolve() : reject(new Error('VS Code integration tests exited with ' + code));
    });
  });
  if (!fs.existsSync(resultPath)) {
    throw new Error('VS Code exited without completing the integration tests. Fixture retained: ' + fixture);
  }
  const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  if (result.result !== 'passed') { throw new Error(result.error + ' (fixture: ' + fixture + ')'); }
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
