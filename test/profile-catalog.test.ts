import assert from 'node:assert/strict';
import * as path from 'node:path';
import { test } from 'node:test';
import { profileCatalogPath, profileIds } from '../src/profile-catalog';

test('resolves the catalog for default, named, and portable user-data locations', () => {
  const root = path.resolve('/isolated/user-data/User');
  for (const storage of [path.join(root, 'globalStorage', 'publisher.extension'),
    path.join(root, 'profiles', 'abc123', 'globalStorage', 'publisher.extension')]) {
    assert.equal(profileCatalogPath(storage), path.join(root, 'globalStorage', 'storage.json'));
  }
  assert.throws(() => profileCatalogPath('/unrelated/location'), /unsupported/);
});

test('maps exact profile names and rejects ambiguous or unsafe catalog data', () => {
  assert.equal(profileIds({ userDataProfiles: [{ name: 'Example', location: 'abc-123' }] }).get('Example'), 'abc-123');
  assert.equal(profileIds({}).get('Default'), 'default');
  assert.equal(profileIds({}).get('Unknown'), undefined);
  for (const value of [null, { userDataProfiles: {} },
    { userDataProfiles: [{ name: 'P', location: '../bad' }] },
    { userDataProfiles: [{ name: 'P', location: 'a' }, { name: 'P', location: 'b' }] }]) {
    assert.throws(() => profileIds(value));
  }
});
