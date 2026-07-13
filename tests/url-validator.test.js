import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMediaUrl } from '../src/url-validator.js';

test('media URL validation rejects credentials, ports, local hosts, and unsupported domains', async () => {
  const unsafe = [
    'http://localhost/watch',
    'http://127.0.0.1/watch',
    'http://2130706433/watch',
    'https://user:pass@youtube.com/watch?v=1',
    'https://youtube.com:8443/watch?v=1',
    'https://youtube.com.evil.example/watch?v=1',
  ];

  for (const value of unsafe) {
    await assert.rejects(validateMediaUrl(value), /tidak diizinkan|tidak aman|belum didukung/, value);
  }
});
