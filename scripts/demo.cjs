// Captures only an isolated VS Code renderer, never the desktop or personal windows.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { downloadAndUnzipVSCode } = require('@vscode/test-electron');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'artifacts', 'demo');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const extensionId = manifest.publisher + '.' + manifest.name;

function write(name, data) {
  fs.mkdirSync(path.dirname(name), { recursive: true });
  fs.writeFileSync(name, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

async function until(check, message) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await sleep(250);
  }
  throw new Error(message);
}

async function connect(port) {
  const target = await until(async () => {
    try {
      const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      return targets.find(candidate => candidate.type === 'page' &&
        candidate.url.includes('workbench') && candidate.webSocketDebuggerUrl);
    } catch { return undefined; }
  }, 'The isolated VS Code renderer did not become available');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (request) {
      clearTimeout(request.timer);
      pending.delete(message.id);
      message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
    }
  });
  socket.addEventListener('close', () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('Renderer closed during capture'));
    }
    pending.clear();
  });
  return {
    close: () => socket.close(),
    call(method, params = {}) {
      return new Promise((resolve, reject) => {
        const requestId = ++id;
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error('Capture command timed out: ' + method));
        }, 10_000);
        pending.set(requestId, { resolve, reject, timer });
        socket.send(JSON.stringify({ id: requestId, method, params }));
      });
    },
  };
}

async function main() {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'git-host-profiles-demo-'));
  const project = path.join(fixture, 'profile-demo');
  const userData = path.join(fixture, 'user-data');
  const user = path.join(userData, 'User');
  const installed = path.join(fixture, 'extensions');
  const controlPath = path.join(fixture, 'control.json');
  const resultPath = path.join(fixture, 'result.json');
  const hooks = path.join(fixture, 'empty-hooks');
  fs.mkdirSync(project);
  fs.mkdirSync(hooks);
  fs.mkdirSync(output, { recursive: true });
  const git = (...args) => {
    const result = spawnSync('git', ['-c', 'core.hooksPath=' + hooks,
      '-c', 'init.templateDir=' + hooks, '-C', project, ...args],
    { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error(result.stderr);
  };
  git('init', '--quiet');
  const stages = [
    { id: '01-github', label: 'GITHUB REMOTE', remote: 'https://github.com/example/project.git',
      selected: 'GitHub', tabSize: 2, note: 'The GitHub rule selects the GitHub profile.' },
    { id: '02-work-git', label: 'SELF-HOSTED REMOTE', remote: 'https://forge.example.org/team/project.git',
      selected: 'Work Git', tabSize: 4, note: 'The self-hosted rule selects the Work Git profile.' },
    { id: '03-unmatched', label: 'NO MATCH', remote: 'https://other.example.net/team/project.git',
      tabSize: 4, note: 'No rule matches. The current Work Git profile stays active.' },
  ];
  git('remote', 'add', 'origin', stages[0].remote);
  const rules = [
    { profile: 'GitHub', remoteHosts: ['github.com'] },
    { profile: 'Work Git', remoteHosts: ['forge.example.org'] },
  ];
  const common = {
    'telemetry.telemetryLevel': 'off', 'update.mode': 'none',
    'extensions.autoCheckUpdates': false, 'extensions.autoUpdate': false,
    'workbench.enableExperiments': false, 'chat.disableAIFeatures': true,
    'security.workspace.trust.enabled': false,
    'git.openRepositoryInParentFolders': 'always', 'git.autofetch': false,
    'git.confirmSync': false, 'git.enableSmartCommit': false,
    'workbench.startupEditor': 'none', 'workbench.tips.enabled': false,
    'workbench.editor.showTabs': 'single', 'workbench.editor.enablePreview': false,
    'workbench.layoutControl.enabled': false, 'workbench.secondarySideBar.defaultVisibility': 'hidden',
    'editor.fontSize': 20, 'editor.lineHeight': 31, 'editor.minimap.enabled': false,
    'editor.cursorBlinking': 'solid', 'editor.renderLineHighlight': 'none',
    'editor.stickyScroll.enabled': false, 'editor.guides.indentation': false,
    'editor.padding.top': 24, 'editor.scrollbar.vertical': 'hidden',
    'editor.scrollbar.horizontal': 'hidden', 'breadcrumbs.enabled': false,
    'window.titleBarStyle': 'custom', 'window.commandCenter': false,
    'window.title': 'Git Host Profiles demo  |  Active profile: ${profileName}',
    'window.zoomLevel': 0, 'workbench.colorTheme': 'Default Dark Modern',
    'gitHostProfiles.rules': rules,
  };
  const style = (accent, surface) => ({
    'titleBar.activeBackground': surface, 'titleBar.activeForeground': '#ffffff',
    'titleBar.inactiveBackground': surface, 'titleBar.inactiveForeground': '#ffffff',
    'statusBar.background': surface, 'statusBar.foreground': '#ffffff',
    'activityBar.activeBorder': accent, 'activityBar.background': '#10121c',
    'editor.background': '#11131e', 'sideBar.background': '#11131e',
    'editorGroupHeader.tabsBackground': '#181b29', 'tab.activeBackground': '#11131e',
    'tab.activeBorderTop': accent,
  });
  write(path.join(user, 'settings.json'), { ...common, 'workbench.colorCustomizations': style('#93a0bb', '#263047') });
  write(path.join(user, 'globalStorage', 'storage.json'), {
    userDataProfiles: [
      { name: 'GitHub', location: 'demo-github', useDefaultFlags: { extensions: true } },
      { name: 'Work Git', location: 'demo-work', useDefaultFlags: { extensions: true } },
    ],
  });
  write(path.join(user, 'profiles', 'demo-github', 'settings.json'), {
    ...common, 'editor.tabSize': 2, 'workbench.colorCustomizations': style('#12d5eb', '#075364'),
  });
  write(path.join(user, 'profiles', 'demo-work', 'settings.json'), {
    ...common, 'editor.tabSize': 4, 'workbench.colorCustomizations': style('#ffbd36', '#64421d'),
  });
  const runtime = path.join(installed, extensionId + '-' + manifest.version);
  write(path.join(runtime, 'package.json'), manifest);
  fs.cpSync(path.join(root, 'dist', 'src'), path.join(runtime, 'dist', 'src'), { recursive: true });
  const probe = path.join(installed, 'demo.git-host-profiles-demo-probe-0.0.0');
  write(path.join(probe, 'package.json'), {
    name: 'git-host-profiles-demo-probe', publisher: 'demo', version: '0.0.0',
    engines: { vscode: '^1.100.0' }, main: './main.cjs', activationEvents: ['onStartupFinished'],
  });
  fs.copyFileSync(path.join(root, 'scripts', 'demo-probe.cjs'), path.join(probe, 'main.cjs'));
  function stage(next) {
    git('remote', 'set-url', 'origin', next.remote);
    write(path.join(project, 'profile-rules.jsonc'),
      '// ' + next.label + '\n// origin: ' + next.remote + '\n// ' + next.note +
      '\n\n// Configure once in your user settings:\n' + JSON.stringify({ 'gitHostProfiles.rules': rules }, null, 2) +
      '\n\n// Profiles and their extensions are configured by you.\n// Remote hosts are compared locally. No forge login is needed.\n');
    write(controlPath, next);
  }
  stage(stages[0]);
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const executable = process.env.VSCODE_EXECUTABLE_PATH ||
    await downloadAndUnzipVSCode(process.env.VSCODE_VERSION || 'stable');
  const env = { ...process.env, GHP_DEMO_EXTENSION_ID: extensionId,
    GHP_DEMO_CONTROL: controlPath, GHP_DEMO_RESULT: resultPath };
  delete env.ELECTRON_RUN_AS_NODE;
  const args = [project, '--new-window', '--user-data-dir=' + userData,
    '--extensions-dir=' + installed, '--shared-data-dir=' + path.join(fixture, 'shared-data'),
    '--disable-updates', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + port];
  if (process.platform === 'linux' && process.getuid?.() === 0) args.push('--no-sandbox');
  console.log('Isolated demo fixture: ' + fixture);
  const log = fs.createWriteStream(path.join(fixture, 'vscode.log'));
  const child = spawn(executable, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  let exited = false;
  let childError;
  child.on('error', error => { childError = error; });
  const closed = new Promise(resolve => child.on('close', () => { exited = true; log.end(); resolve(); }));
  try {
    for (const current of stages) {
      if (current !== stages[0]) stage(current);
      const result = await until(async () => {
        if (childError) throw childError;
        if (exited) throw new Error('The isolated demo window exited before capture');
        if (!fs.existsSync(resultPath)) return undefined;
        const value = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
        if (value.error) throw new Error(value.error);
        return value.id === current.id ? value : undefined;
      }, 'Profile state not reached: ' + current.id);
      const cdp = await connect(port);
      try {
        await cdp.call('Emulation.setDeviceMetricsOverride', {
          width: 1120, height: 780, deviceScaleFactor: 1, mobile: false,
        });
        await sleep(1000);
        const title = await cdp.call('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
        const expected = current.selected || 'Work Git';
        if (!title.result.value.includes(expected)) {
          throw new Error('The native window title does not show profile ' + expected + ': ' + title.result.value);
        }
        const capture = await cdp.call('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(output, current.id + '.png'), Buffer.from(capture.data, 'base64'));
        console.log('Captured ' + current.id + ': ' + expected);
        write(path.join(output, current.id + '.json'), { ...result, title: title.result.value });
      } finally { cdp.close(); }
    }
    write(path.join(output, 'capture.json'), {
      extensionId, version: manifest.version, stages: stages.map(item => item.id),
      note: 'Real VS Code profile switches using synthetic remotes and isolated profiles.',
    });
  } finally {
    if (!exited) child.kill();
    await Promise.race([closed, sleep(5000)]);
  }
  if (process.platform === 'win32') {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-File',
      path.join(root, 'scripts', 'encode-demo.ps1'), '-FramesDirectory', output,
      '-OutputDirectory', path.join(root, 'media')], { stdio: 'inherit', windowsHide: true });
    if (result.status !== 0) throw new Error('GIF encoding failed');
  } else {
    console.log('PNG frames are ready in artifacts/demo/. See docs/MEDIA.md for GIF encoding.');
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
