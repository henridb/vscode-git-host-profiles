import { isIP } from 'node:net';

export interface Rule {
  readonly profile: string;
  readonly remoteHosts?: readonly string[];
  readonly folders?: readonly string[];
  readonly files?: readonly string[];
  readonly fileExtensions?: readonly string[];
}

export interface Target {
  readonly folder: string;
  readonly hosts: readonly (string | null)[];
  readonly files: ReadonlySet<string>;
}

export interface Snapshot {
  readonly targets: readonly Target[];
  readonly standaloneFile?: string;
  readonly home: string;
  readonly caseSensitive: boolean;
}

export interface Decision {
  readonly profile?: string;
  readonly reason: string;
  readonly rules: readonly number[];
}

const selectors = ['remoteHosts', 'folders', 'files', 'fileExtensions'] as const;

/** Reject malformed rules as a whole, rather than silently widening their match. */
export function parseRules(value: unknown): Rule[] {
  if (!Array.isArray(value)) {
    throw new Error('Rules must be an array.');
  }
  return value.map((entry: unknown, index: number) => {
    const fail = (message: string): never => {
      throw new Error('Rule ' + (index + 1) + ': ' + message);
    };
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return fail('expected an object.');
    }
    const record = entry as Record<string, unknown>;
    if (Object.keys(record).some(key => key !== 'profile' && !selectors.includes(key as typeof selectors[number]))) {
      return fail('unknown setting.');
    }
    if (typeof record.profile !== 'string' || !record.profile.trim()) {
      return fail('profile must be a nonempty name.');
    }
    if (!selectors.some(key => record[key] !== undefined)) {
      return fail('at least one matching condition is required.');
    }
    if (record.fileExtensions !== undefined &&
        ['remoteHosts', 'folders', 'files'].some(key => record[key] !== undefined)) {
      return fail('standalone file extensions cannot be combined with workspace conditions.');
    }
    const rule: Record<string, unknown> = { profile: record.profile };
    for (const key of selectors) {
      const values = record[key];
      if (values === undefined) {
        continue;
      }
      if (!Array.isArray(values) || values.length === 0 ||
          !values.every(item => typeof item === 'string' && item.trim().length > 0)) {
        return fail(key + ' must contain nonempty strings.');
      }
      if (key === 'remoteHosts' && !values.every(item => /^[a-zA-Z0-9.*?_-]+$/.test(item) ||
        (item.startsWith('[') && item.endsWith(']') && isIP(item.slice(1, -1)) === 6))) {
        return fail('remoteHosts must contain hostnames or host patterns, without URLs or ports.');
      }
      if (key === 'files' && !values.every(item =>
        !item.startsWith('/') && !item.includes('\\') && !/^[a-z]:/i.test(item) &&
        !item.split('/').includes('..'))) {
        return fail('files must contain relative forward-slash patterns without parent traversal.');
      }
      if (key === 'fileExtensions' && !values.every(item => /^\.?[a-zA-Z0-9][a-zA-Z0-9.+_-]*$/.test(item))) {
        return fail('fileExtensions must contain filename suffixes.');
      }
      rule[key] = [...values];
    }
    return rule as unknown as Rule;
  });
}
