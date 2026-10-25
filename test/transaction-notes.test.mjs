import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setup } from './helpers/harness.mjs';

test('transaction notes can be written, read back and cleared, while conflicting text is rejected', async () => {
  const w = await setup({ });
  try {
    const tx = w.mock.state.feed[0].feedItemUid;
    assert.equal((await w.run('transactions', 'note', tx, 'Temporary note')).exitCode, 0);
    assert.equal((await w.run('transactions', 'get', tx)).data.userNote, 'Temporary note');
    const cleared = await w.run('transactions', 'note', tx, '--clear');
    assert.equal(cleared.exitCode, 0, cleared.stdout);
    assert.equal(w.mock.callsTo('updateUserNote').at(-1).body.userNote, '');
    assert.equal((await w.run('transactions', 'get', tx)).data.userNote, '');
    assert.equal((await w.run('transactions', 'note', tx, 'keep', '--clear')).error.code, 'USAGE');
  } finally { await w.cleanup(); }
});
