import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import * as vscode from 'vscode';
import type { GitExtension } from '../src/git';
import type { ExtensionApi } from '../src/extension';

async function until(check: () => Promise<boolean>, message: string): Promise<void> {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(message);
}

/**
 * A test-only probe survives the real extension-host restarts caused by
 * profile switching. Its phase file and settings exist only in the test fixture.
 */
export function activate(): void {
  void run().catch(async error => {
    const result = process.env.GHP_TEST_RESULT;
    if (result) {
      await writeFile(result, JSON.stringify({ result: 'failed', error: String(error) }));
    }
    await vscode.commands.executeCommand('workbench.action.closeWindow');
  });
}

async function run(): Promise<void> {
  const result = process.env.GHP_TEST_RESULT;
  assert.ok(result, 'Integration fixture is configured');
  const phasePath = result + '.phase';
  const phase = await readFile(phasePath, 'utf8');
  const extensionId = process.env.GHP_TEST_EXTENSION_ID;
  assert.ok(extensionId);
  const extension = vscode.extensions.getExtension<ExtensionApi>(extensionId);
  assert.ok(extension, 'Development extension is available');
  const api = await extension.activate();
  await until(async () => (await api.inspect()).ready, 'Git discovery did not finish');
  const configuration = vscode.workspace.getConfiguration('gitHostProfiles');
  const git = vscode.extensions.getExtension<GitExtension>('vscode.git')!.exports.getAPI(1);
  const submodule = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0]!.uri, 'vendor/library');
  await git.openRepository(submodule);
  await until(async () => git.repositories.some(repository =>
    repository.rootUri.path.endsWith('/vendor/library') &&
    repository.state.remotes.some(remote => remote.fetchUrl === 'https://other.example.org/team/library.git')),
  'Git did not discover the conflicting submodule');

  if (phase === 'host') {
    assert.equal((await api.inspect()).decision.profile, 'Example Forge',
      'The top-level repository selects the profile despite a conflicting submodule and workspace rule');
    await until(async () => vscode.workspace.getConfiguration('editor').get('tabSize') === 7,
      'Automatic remote-host selection did not switch to the named profile: ' +
      JSON.stringify(vscode.workspace.getConfiguration('editor').inspect('tabSize')));
    assert.equal((await api.inspect()).decision.profile, 'Example Forge', 'Application rules survive a profile switch');
    await vscode.commands.executeCommand('gitHostProfiles.togglePause');
    assert.equal((await api.inspect()).paused, true);
    await configuration.update('rules', [{
      profile: 'Example Folder',
      folders: ['**/gits/gh-*/**'],
      files: ['package.json', 'src/**/*.ts'],
    }], vscode.ConfigurationTarget.Global);
    assert.equal(vscode.workspace.getConfiguration('editor').get('tabSize'), 7, 'Pause retains the current profile');
    await writeFile(phasePath, 'folder');
    await vscode.commands.executeCommand('gitHostProfiles.togglePause');
    return;
  }

  assert.equal(phase, 'folder');
  await until(async () => vscode.workspace.getConfiguration('editor').get('tabSize') === 9,
    'Folder glob and project-file selection did not switch profiles');
  assert.equal((await api.inspect()).decision.profile, 'Example Folder');
  // A mixed-host repository must not choose the first matching host.
  await vscode.commands.executeCommand('gitHostProfiles.togglePause');
  const main = git.repositories.find(repository => repository.state.remotes.some(remote =>
    remote.fetchUrl === 'https://forge.example.org/team/repository.git'));
  assert.ok(main, 'Main repository is available');
  await main.addRemote('secondary', 'https://other.example.org/team/repository.git');
  await until(async () => main.state.remotes.some(remote => remote.name === 'secondary'),
    'Git did not discover the second remote destination');
  await configuration.update('rules', [
    { profile: 'Example Forge', remoteHosts: ['forge.example.org'] },
    { profile: 'Example Folder', remoteHosts: ['other.example.org'] },
  ], vscode.ConfigurationTarget.Global);
  await vscode.commands.executeCommand('gitHostProfiles.togglePause');
  await until(async () => (await api.inspect()).ready, 'Resume did not take effect');
  await new Promise(resolve => setTimeout(resolve, 700));
  assert.equal((await api.inspect()).decision.profile, undefined, 'Mixed destinations keep the current profile');
  assert.equal(vscode.workspace.getConfiguration('editor').get('tabSize'), 9);
  await configuration.update('rules', [
    { profile: 'Example Forge', remoteHosts: ['unmatched.example.org'] },
  ], vscode.ConfigurationTarget.Global);
  await until(async () => (await api.inspect()).decision.profile === undefined, 'Unmatched rules did not take effect');
  await vscode.commands.executeCommand('gitHostProfiles.apply');
  await new Promise(resolve => setTimeout(resolve, 700));
  assert.equal(vscode.workspace.getConfiguration('editor').get('tabSize'), 9, 'Unmatched rules retain the current profile');

  await configuration.update('enabled', false, vscode.ConfigurationTarget.Global);
  assert.equal((await api.inspect()).enabled, false);
  await writeFile(result, JSON.stringify({
    result: 'passed',
    vscode: vscode.version,
    workspaceFolders: vscode.workspace.workspaceFolders?.length,
    checks: ['Git API discovery', 'conflicting submodule excluded', 'user-only rules', 'automatic profile switch in a new repository',
      'profile reload persistence', 'rules shared across profiles', 'pause/resume',
      'folder glob', 'project files', 'mixed remote destinations', 'unmatched profile retained', 'disable'],
  }, null, 2));
  await vscode.commands.executeCommand('workbench.action.closeWindow');
}
