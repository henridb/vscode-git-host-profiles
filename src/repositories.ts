import * as path from 'node:path';
import type * as vscode from 'vscode';

type Location = Pick<vscode.Uri, 'scheme' | 'authority' | 'fsPath'>;

export function belongsTo(parent: Location, child: Location): boolean {
  if (parent.scheme !== child.scheme || parent.authority !== child.authority) {
    return false;
  }
  const relative = path.relative(parent.fsPath, child.fsPath);
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

/** Dependencies inside another selected repository do not select its profile. */
export function topLevelRepositories<T extends { readonly rootUri: Location }>(
  workspaceFolder: Location,
  repositories: readonly T[],
): T[] {
  const candidates = repositories.filter(repository => belongsTo(workspaceFolder, repository.rootUri));
  return candidates.filter(repository => !candidates.some(parent =>
    parent !== repository &&
    belongsTo(parent.rootUri, repository.rootUri) &&
    !belongsTo(repository.rootUri, parent.rootUri)));
}
