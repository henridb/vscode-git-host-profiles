import type { Decision, Rule, Snapshot, Target } from './model';

/** Parse URL-style and scp-style remotes without running Git or contacting a host. */
export function remoteHost(remote: string): string | null {
  const value = remote.trim();
  if (/^[a-z][a-z0-9+.-]*::/i.test(value)) {
    return null;
  }
  if (/^[a-z]:[\\/]/i.test(value) || value.startsWith('/') || value.startsWith('\\') ||
      value.startsWith('./') || value.startsWith('../')) {
    return null;
  }
  if (value.includes('://')) {
    try {
      const parsed = new URL(value);
      if (!['http:', 'https:', 'ssh:', 'git:', 'git+ssh:'].includes(parsed.protocol)) {
        return null;
      }
      return parsed.hostname.toLowerCase().replace(/\.$/, '');
    } catch {
      return null;
    }
  }
  const match = /^(?:[^@\s/:]+@)?(\[[^\]]+\]|[^\s/:]+):(.+)$/.exec(value);
  return match?.[1]?.toLowerCase().replace(/\.$/, '') ?? null;
}

/** Small glob dialect: *, ?, and **. No regex or executable expressions from settings. */
export function globMatches(pattern: string, value: string, caseSensitive = true): boolean {
  let expression = '^';
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index]!;
    if (character === '*' && pattern[index + 1] === '*') {
      index++;
      if (pattern[index + 1] === '/') {
        index++;
        expression += '(?:.*/)?';
      } else {
        expression += '.*';
      }
    } else if (character === '*') {
      expression += '[^/]*';
    } else if (character === '?') {
      expression += '[^/]';
    } else {
      expression += character.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    }
  }
  return new RegExp(expression + '$', caseSensitive ? '' : 'i').test(value);
}

export function folderMatches(pattern: string, folder: string, home: string, caseSensitive: boolean): boolean {
  let expanded = pattern.replace(/\\/g, '/');
  if (expanded === '~' || expanded.startsWith('~/')) {
    expanded = home.replace(/\\/g, '/') + expanded.slice(1);
  }
  return globMatches(expanded.replace(/\/+$/, ''), folder.replace(/\\/g, '/').replace(/\/+$/, ''), caseSensitive);
}

function matchesTarget(rule: Rule, target: Target, snapshot: Snapshot): boolean {
  if (rule.fileExtensions) {
    return false;
  }
  if (rule.remoteHosts && (target.hosts.length === 0 || !target.hosts.every(host =>
    host !== null && rule.remoteHosts!.some(pattern => globMatches(pattern.toLowerCase(), host))))) {
    return false;
  }
  if (rule.folders && !rule.folders.some(pattern =>
    folderMatches(pattern, target.folder, snapshot.home, snapshot.caseSensitive))) {
    return false;
  }
  return !rule.files || rule.files.every(pattern => target.files.has(pattern));
}

export function decide(rules: readonly Rule[], snapshot: Snapshot): Decision {
  if (snapshot.targets.length === 0) {
    if (!snapshot.standaloneFile) {
      return { reason: 'No workspace or standalone file is open.', rules: [] };
    }
    const filename = snapshot.standaloneFile.toLowerCase();
    const index = rules.findIndex(rule => rule.fileExtensions && !rule.remoteHosts && !rule.folders && !rule.files &&
      rule.fileExtensions.some(extension => filename.endsWith('.' + extension.replace(/^\./, '').toLowerCase())));
    return index < 0
      ? { reason: 'No standalone-file rule matches.', rules: [] }
      : { profile: rules[index]!.profile, reason: 'Standalone file matches rule ' + (index + 1) + '.', rules: [index] };
  }
  const matches = snapshot.targets.map(target => rules.findIndex(rule => matchesTarget(rule, target, snapshot)));
  if (matches.some(index => index < 0)) {
    return { reason: 'At least one repository or folder has no matching rule; keeping the current profile.', rules: matches.filter(index => index >= 0) };
  }
  const profiles = new Set(matches.map(index => rules[index]!.profile));
  if (profiles.size !== 1) {
    return { reason: 'Repositories or folders select different profiles; keeping the current profile.', rules: matches };
  }
  return { profile: rules[matches[0]!]!.profile, reason: 'All repositories and folders select the same profile.', rules: matches };
}
