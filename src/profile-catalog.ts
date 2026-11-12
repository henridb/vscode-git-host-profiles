import * as path from 'node:path';

/** Both default and named profile storage locations resolve to the same local catalog. */
export function profileCatalogPath(extensionStoragePath: string): string {
  const globalStorage = path.dirname(extensionStoragePath);
  if (path.basename(globalStorage) !== 'globalStorage') {
    throw new Error('The VS Code profile storage layout is unsupported.');
  }
  let userDirectory = path.dirname(globalStorage);
  if (path.basename(path.dirname(userDirectory)) === 'profiles') {
    userDirectory = path.dirname(path.dirname(userDirectory));
  }
  return path.join(userDirectory, 'globalStorage', 'storage.json');
}

export function profileIds(value: unknown): ReadonlyMap<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The VS Code profile catalog is invalid.');
  }
  const entries = (value as Record<string, unknown>).userDataProfiles ?? [];
  if (!Array.isArray(entries)) {
    throw new Error('The VS Code profile catalog is unsupported.');
  }
  const result = new Map<string, string>([['Default', 'default']]);
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string' ||
        typeof entry.location !== 'string' || !/^[\w-]+$/.test(entry.location)) {
      throw new Error('The VS Code profile catalog is unsupported.');
    }
    if (result.has(entry.name)) {
      throw new Error('The VS Code profile catalog contains duplicate names.');
    }
    result.set(entry.name, entry.location);
  }
  return result;
}
