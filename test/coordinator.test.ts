import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SwitchCoordinator, type DecisionState } from '../src/coordinator';

function state(): DecisionState {
  const values = new Map<string, unknown>();
  return {
    get: <T>(key: string) => values.get(key) as T | undefined,
    update: async (key, value) => { values.set(key, value); },
  };
}

test('persists before switching and prevents a restart loop', async () => {
  const storage = state();
  let calls = 0;
  const switchTo = async () => {
    assert.equal(storage.get('lastDecision'), 'same-context');
    calls++;
  };
  assert.equal(await new SwitchCoordinator(storage, switchTo).apply('same-context', 'P'), true);
  assert.equal(await new SwitchCoordinator(storage, switchTo).apply('same-context', 'P'), false);
  assert.equal(calls, 1);
});

test('serializes duplicate events and permits explicit reapplication', async () => {
  let calls = 0;
  const coordinator = new SwitchCoordinator(state(), async () => { calls++; });
  await Promise.all([coordinator.apply('same', 'P'), coordinator.apply('same', 'P')]);
  assert.equal(calls, 1);
  await coordinator.apply('same', 'P', true);
  assert.equal(calls, 2);
});

test('a failed switch can be retried and does not poison later events', async () => {
  const storage = state();
  await storage.update('lastDecision', 'previous');
  let calls = 0;
  const coordinator = new SwitchCoordinator(storage, async () => {
    if (++calls === 1) {
      throw new Error('missing profile');
    }
  });
  await assert.rejects(coordinator.apply('new', 'P'), /missing profile/);
  assert.equal(storage.get('lastDecision'), 'previous');
  await coordinator.apply('new', 'P');
  assert.equal(calls, 2);
});

test('an unmatched context breaks the previous decision history', async () => {
  let calls = 0;
  const coordinator = new SwitchCoordinator(state(), async () => { calls++; });
  await coordinator.apply('matched', 'P');
  await coordinator.apply('unmatched', undefined);
  await coordinator.apply('matched', 'P');
  assert.equal(calls, 2);
});
