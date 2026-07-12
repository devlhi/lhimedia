import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DOWNLOAD_CONCURRENCY = '1';
process.env.DOWNLOAD_QUEUE_LIMIT = '1';
process.env.PORT ||= '3100';
const { getDownloadQueueStatus, runDownloadJob } = await import('../src/download-queue.js');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('download queue enforces per-user and queue limits', async () => {
  const gate = deferred();
  const first = runDownloadJob({ source: 'telegram', userRef: '1' }, () => gate.promise);
  await Promise.resolve();
  await assert.rejects(runDownloadJob({ source: 'telegram', userRef: '1' }, async () => 'duplicate'), /download aktif/);
  const second = runDownloadJob({ source: 'telegram', userRef: '2' }, async () => 'second');
  await assert.rejects(runDownloadJob({ source: 'telegram', userRef: '3' }, async () => 'full'), /Antrean download sedang penuh/);
  assert.deepEqual(getDownloadQueueStatus(), { active: 1, queued: 1, capacity: 1, queueLimit: 1 });
  gate.resolve('first');
  assert.equal(await first, 'first');
  assert.equal(await second, 'second');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(getDownloadQueueStatus().active, 0);
});
