// Installed only in the isolated demo fixture; never shipped in the VSIX.
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

exports.activate = function activate(context) {
  let disposed = false;
  context.subscriptions.push({ dispose() { disposed = true; } });
  void run(() => disposed).catch(async error => {
    await fs.writeFile(process.env.GHP_DEMO_RESULT, JSON.stringify({ error: String(error) }));
  });
};

async function run(disposed) {
  const extension = vscode.extensions.getExtension(process.env.GHP_DEMO_EXTENSION_ID);
  if (!extension) throw new Error('Demo extension is not installed');
  const api = await extension.activate();
  const gitExtension = vscode.extensions.getExtension('vscode.git');
  await gitExtension.activate();
  const git = gitExtension.exports.getAPI(1);
  let processed;
  while (!disposed()) {
    const control = JSON.parse(await fs.readFile(process.env.GHP_DEMO_CONTROL, 'utf8'));
    if (control.id !== processed) {
      if (git.state !== 'initialized' || !git.repositories.length) {
        await sleep(250);
        continue;
      }
      await git.repositories[0].status();
      const inspection = await api.inspect();
      const tabSize = vscode.workspace.getConfiguration('editor').get('tabSize');
      if (inspection.ready && inspection.decision.profile === control.selected && tabSize === control.tabSize) {
        const origin = git.repositories[0].state.remotes.find(remote => remote.name === 'origin');
        if (origin?.fetchUrl !== control.remote) {
          await sleep(250);
          continue;
        }
        const document = await vscode.workspace.openTextDocument(
          vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, 'profile-rules.jsonc'));
        const editor = await vscode.window.showTextDocument(document, { preview: false });
        editor.selection = new vscode.Selection(0, 0, 0, 0);
        editor.revealRange(new vscode.Range(0, 0, 0, 0));
        await vscode.commands.executeCommand('workbench.action.closeSidebar');
        await vscode.commands.executeCommand('notifications.clearAll');
        await sleep(800);
        await fs.writeFile(process.env.GHP_DEMO_RESULT, JSON.stringify({
          id: control.id, selected: inspection.decision.profile,
          tabSize, remote: origin.fetchUrl, vscode: vscode.version,
        }));
        processed = control.id;
      }
    }
    await sleep(250);
  }
}
