import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { getSystemMetrics } from '../src/system-metrics.js';

test('system metrics menghasilkan angka resource yang aman', () => {
  const metrics = getSystemMetrics({ diskPath: os.tmpdir() });
  assert.ok(metrics.host.cpuCount >= 1);
  assert.equal(metrics.host.loadAverage.length, 3);
  assert.ok(metrics.host.memory.totalMb > 0);
  assert.ok(metrics.host.memory.usedPercent >= 0 && metrics.host.memory.usedPercent <= 100);
  assert.equal(metrics.application.pid, process.pid);
  assert.ok(metrics.application.rssMb > 0);
  if (metrics.host.disk) {
    assert.ok(metrics.host.disk.totalGb > 0);
    assert.ok(metrics.host.disk.usedPercent >= 0 && metrics.host.disk.usedPercent <= 100);
  }
});

test('disk metrics gagal secara aman untuk path yang tidak tersedia', () => {
  const metrics = getSystemMetrics({ diskPath: `${os.tmpdir()}/botlink-path-does-not-exist` });
  assert.equal(metrics.host.disk, null);
  assert.ok(metrics.host.memory.totalMb > 0);
});
