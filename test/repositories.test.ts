import assert from 'node:assert/strict';
import * as path from 'node:path';
import { test } from 'node:test';
import { topLevelRepositories } from '../src/repositories';

function location(fsPath: string, scheme = 'file', authority = '') {
  return { fsPath: path.resolve(fsPath), scheme, authority };
}

function repository(fsPath: string, scheme = 'file', authority = '') {
  return { rootUri: location(fsPath, scheme, authority) };
}

test('a parent repository excludes nested repositories regardless of discovery order', () => {
  const workspace = location('/projects/application');
  const parent = repository('/projects/application');
  const submodule = repository('/projects/application/vendor/library');
  const nested = repository('/projects/application/vendor/library/vendor/another');
  for (const discovered of [[parent, submodule, nested], [nested, submodule, parent]]) {
    assert.deepEqual(topLevelRepositories(workspace, discovered), [parent]);
  }
});

test('a container folder retains independent sibling repositories without confusing path prefixes', () => {
  const workspace = location('/projects');
  const first = repository('/projects/repo');
  const sibling = repository('/projects/repo-other');
  const dependency = repository('/projects/repo/vendor/library');
  const outside = repository('/unrelated/repo');
  assert.deepEqual(topLevelRepositories(workspace, [first, dependency, sibling, outside]), [first, sibling]);
});

test('a submodule opened as its own workspace root is evaluated independently', () => {
  const parent = repository('/projects/application');
  const submodule = repository('/projects/application/vendor/library');
  assert.deepEqual(topLevelRepositories(submodule.rootUri, [parent, submodule]), [submodule]);
});

test('a folder without a discovered repository inside it leaves folder fallback available', () => {
  const workspace = location('/projects/application/docs');
  const enclosing = repository('/projects/application');
  assert.deepEqual(topLevelRepositories(workspace, [enclosing, repository('/elsewhere')]), []);
});

test('repository containment respects URI scheme and authority', () => {
  const workspace = location('/projects', 'test', 'server-a');
  const repositoryOnSameServer = repository('/projects/repo', 'test', 'server-a');
  assert.deepEqual(topLevelRepositories(workspace, [
    repository('/projects', 'file'),
    repository('/projects', 'test', 'server-b'),
    repositoryOnSameServer,
  ]), [repositoryOnSameServer]);
});
