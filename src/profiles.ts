import { readFile } from 'node:fs/promises';
import * as vscode from 'vscode';

import { profileCatalogPath, profileIds } from './profile-catalog';

export const PROFILE_COMMAND_PREFIX = 'workbench.profiles.actions.profileEntry.';

/**
 * Compatibility boundary: VS Code has no public profile switching API.
 * Never write internal storage and never fall back to executing a shell command.
 */
export class ProfileSwitcher {
  constructor(private readonly globalStorageUri: vscode.Uri) {}

  async switchTo(name: string): Promise<void> {
    let catalog: unknown;
    try {
      catalog = JSON.parse(await readFile(profileCatalogPath(this.globalStorageUri.fsPath), 'utf8'));
    } catch {
      throw new Error('Cannot read the local VS Code profile catalog. Open Profiles to verify that a named profile exists.');
    }
    const id = profileIds(catalog).get(name);
    if (!id) {
      throw new Error('The configured profile does not exist. Create it in VS Code Profiles first.');
    }
    const command = PROFILE_COMMAND_PREFIX + id;
    if (!(await vscode.commands.getCommands(true)).includes(command)) {
      throw new Error('Profile switching is unavailable in this VS Code version. Use Profiles: Switch Profile manually.');
    }
    await vscode.commands.executeCommand(command);
    // A newly associated workspace may retain its current profile until reload.
    // The persisted decision marker prevents this reload from running again.
    if (vscode.workspace.workspaceFolders?.length) {
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
  }
}
