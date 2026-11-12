import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide, folderMatches, globMatches, remoteHost } from '../src/matching';
import { parseRules, type Rule, type Snapshot, type Target } from '../src/model';

const target = (hosts: readonly (string | null)[] = ['forge.example.org'], folder = '/projects/gh-team/repo', files: string[] = []): Target =>
  ({ folder, hosts, files: new Set(files) });
const snapshot = (...targets: Target[]): Snapshot => ({ targets, home: '/home/example', caseSensitive: true });
const hostRules: Rule[] = [
  { profile: 'Forge', remoteHosts: ['forge.example.org'] },
  { profile: 'Other', remoteHosts: ['other.example.org'] },
];

test('parses HTTPS, SSH, scp, ports and credentials without exposing URL parts', () => {
  const cases = [
    ['https://user:password@FORGE.example.org:8443/team/repo.git', 'forge.example.org'],
    ['ssh://git@forge.example.org:2222/team/repo.git', 'forge.example.org'],
    ['git@forge.example.org:team/repo.git', 'forge.example.org'],
    ['forge.example.org:team/repo.git', 'forge.example.org'],
    ['git://forge.example.org/team/repo.git', 'forge.example.org'],
    ['git+ssh://git@forge.example.org/team/repo.git', 'forge.example.org'],
    ['https://forge.example.org./team/repo', 'forge.example.org'],
    ['ssh://git@[2001:db8::1]:2222/repo', '[2001:db8::1]'],
  ] as const;
  for (const [url, host] of cases) {
    assert.equal(remoteHost(url), host);
  }
});

test('local paths, unsupported transports, and malformed URLs are unknown', () => {
  for (const value of ['/srv/repo', './repo', '../repo', 'C:\\repos\\repo', 'C:/repos/repo',
    '\\\\server\\share', 'file:///srv/repo', 'https://', 'ext::some-command', 'plain-folder', '']) {
    assert.equal(remoteHost(value), null, value);
  }
});

test('host matching respects domain boundaries and mixed remote destinations', () => {
  assert.equal(decide(hostRules, snapshot(target(['forge.example.org.attacker.test']))).profile, undefined);
  assert.equal(decide(hostRules, snapshot(target(['forge.example.org', 'other.example.org']))).profile, undefined);
  assert.equal(decide(hostRules, snapshot(target(['forge.example.org', null]))).profile, undefined);
  assert.equal(decide(hostRules, snapshot(target([]))).profile, undefined);
  assert.equal(decide([{ profile: 'Forge', remoteHosts: ['*.example.org'] }], snapshot(target())).profile, 'Forge');
});

test('folder globs cover new parent groups and nested projects on Windows and Unix', () => {
  assert.ok(folderMatches('~/Documents/gits/gh-*/**', 'C:\\Users\\example\\Documents\\gits\\gh-new\\repo',
    'C:\\Users\\example', false));
  assert.ok(folderMatches('**/gits/gl-*/**', '/home/example/gits/gl-new/repo/deep', '/home/example', true));
  assert.ok(folderMatches('c:/projects/**', 'C:\\PROJECTS\\repo', '', false));
  assert.equal(folderMatches('/projects/gh-*/*', '/projects/gh-team/repo/deep', '', true), false);
  assert.equal(folderMatches('/projects/**', '/other/projects/repo', '', true), false);
});

test('glob syntax escapes regex characters and handles zero or many directory levels', () => {
  assert.ok(globMatches('**/repo', 'repo'));
  assert.ok(globMatches('**/repo', 'a/b/repo'));
  assert.ok(globMatches('/a/[literal](x)+.repo', '/a/[literal](x)+.repo'));
  assert.equal(globMatches('/a/[literal](x)+.repo', '/a/literalx.repo'), false);
  assert.ok(globMatches('repo-?', 'repo-a'));
  assert.equal(globMatches('repo-*', 'repo-a/nested'), false);
});

test('first matching rule wins, with AND across selector types', () => {
  const rules: Rule[] = [
    { profile: 'Specific', remoteHosts: ['forge.example.org'], folders: ['**/private/**'] },
    { profile: 'General', remoteHosts: ['forge.example.org'] },
  ];
  assert.equal(decide(rules, snapshot(target())).profile, 'General');
  assert.equal(decide(rules, snapshot(target(['forge.example.org'], '/private/repo'))).profile, 'Specific');
});

test('every file pattern must be present and can combine with a host rule', () => {
  const rules: Rule[] = [{ profile: 'Project', files: ['package.json', 'src/**/*.ts'], remoteHosts: ['forge.example.org'] }];
  assert.equal(decide(rules, snapshot(target(['forge.example.org'], '/repo', ['package.json']))).profile, undefined);
  assert.equal(decide(rules, snapshot(target(['forge.example.org'], '/repo', ['package.json', 'src/**/*.ts']))).profile, 'Project');
});

test('all repositories and workspace folders must agree, including unmatched folders', () => {
  assert.equal(decide(hostRules, snapshot(target(), target(['forge.example.org'], '/other'))).profile, 'Forge');
  assert.equal(decide(hostRules, snapshot(target(), target(['other.example.org']))).profile, undefined);
  assert.equal(decide(hostRules, snapshot(target(), target([]))).profile, undefined);
});

test('standalone file rules run only without workspace folders', () => {
  const rules: Rule[] = [{ profile: 'Types', fileExtensions: ['.d.ts'] }, { profile: 'Python', fileExtensions: ['py'] }];
  assert.equal(decide(rules, { ...snapshot(), standaloneFile: '/tmp/EXAMPLE.D.TS' }).profile, 'Types');
  assert.equal(decide(rules, { ...snapshot(), standaloneFile: '/tmp/main.py' }).profile, 'Python');
  assert.equal(decide(rules, { ...snapshot(target()), standaloneFile: '/tmp/main.py' }).profile, undefined);
  assert.equal(decide(rules, snapshot()).profile, undefined);
});

test('invalid settings fail closed instead of broadening a rule', () => {
  for (const input of [null, {}, [{ profile: 'P' }], [{ profile: 'P', remoteHost: ['host'] }],
    [{ profile: 'P', folders: [] }], [{ profile: '', folders: ['**'] }],
    [{ profile: 'P', remoteHosts: ['https://forge.example.org'] }],
    [{ profile: 'P', files: ['../secret'] }], [{ profile: 'P', files: ['/absolute/file'] }],
    [{ profile: 'P', fileExtensions: ['a/b'] }],
    [{ profile: 'P', fileExtensions: ['py'], folders: ['**'] }]]) {
    assert.throws(() => parseRules(input));
  }
});

test('validation and selection do not mutate callers or retain mutable selector arrays', () => {
  const input = [{ profile: 'P', folders: ['**'] }];
  const rules = parseRules(input);
  input[0]!.folders[0] = '/different';
  assert.deepEqual(rules, [{ profile: 'P', folders: ['**'] }]);
  const state = snapshot(target());
  assert.equal(decide(rules, state).profile, 'P');
  assert.deepEqual([...state.targets[0]!.files], []);
});

test('IPv6 literal hosts can be configured and match both supported SSH forms', () => {
  const rules = parseRules([{ profile: 'IPv6', remoteHosts: ['[2001:db8::1]'] }]);
  assert.equal(decide(rules, snapshot(target([remoteHost('git@[2001:db8::1]:team/repo')]))).profile, 'IPv6');
  assert.equal(decide(rules, snapshot(target([remoteHost('ssh://git@[2001:db8::1]:2222/team/repo')]))).profile, 'IPv6');
});
