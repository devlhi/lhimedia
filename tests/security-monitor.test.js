import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifySuspiciousRequest,
  normalizeRoutePath,
  pseudonymizeAddress,
  sanitizeSecurityEvent,
} from '../src/security-monitor.js';

test('normalisasi route menghapus query dan merahasiakan webhook Telegram', () => {
  const secretPath = '/telegram/webhook/abcdefghijklmnopqrstuvwxyz123456';
  assert.equal(normalizeRoutePath(`${secretPath}?token=rahasia`, secretPath), '/telegram/webhook/[redacted]');
  assert.equal(normalizeRoutePath('/download?source=secret'), '/download');
});

test('alamat sumber dipseudonimkan secara deterministik tanpa menyimpan IP', () => {
  const first = pseudonymizeAddress('203.0.113.9', 'a-secure-test-secret');
  const second = pseudonymizeAddress('203.0.113.9', 'a-secure-test-secret');
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{16}$/);
  assert.notEqual(first, '203.0.113.9');
});

test('scanner path dan penolakan admin diklasifikasikan defensif', () => {
  assert.deepEqual(classifySuspiciousRequest({ path: '/.env', method: 'GET', statusCode: 404 }), {
    category: 'scanner_path', severity: 'high', summary: 'Path pemindaian terdeteksi (GET)',
  });
  assert.equal(classifySuspiciousRequest({ path: '/admin', method: 'GET', statusCode: 401, isAdmin: true })?.category, 'admin_auth');
  assert.equal(classifySuspiciousRequest({ path: '/', method: 'GET', statusCode: 200 }), null);
});

test('event keamanan membatasi field dan karakter kontrol', () => {
  const event = sanitizeSecurityEvent({
    source: 'untrusted', category: '../Bad Event', severity: 'invalid',
    summary: 'baris satu\nbaris dua', actorHash: 'zzAA0011', path: '/safe?secret=1', metadata: 'a\tb',
  });
  assert.equal(event.source, 'application');
  assert.equal(event.category, 'BadEvent');
  assert.equal(event.severity, 'low');
  assert.equal(event.summary, 'baris satu baris dua');
  assert.equal(event.actorHash, 'AA0011');
  assert.equal(event.path, '/safe');
  assert.equal(event.metadata, 'a b');
});
