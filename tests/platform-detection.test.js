import test from 'node:test';
import assert from 'node:assert/strict';
import { platforms } from '../public/js/platforms.js';

function detect(input) {
  const url = new URL(input);
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  return [...platforms].find(([domain]) => host === domain || host.endsWith(`.${domain}`))?.[1] || null;
}

test('public platform registry recognizes exact hosts and safe subdomains', () => {
  assert.equal(detect('https://www.youtube.com/watch?v=abc'), 'YouTube');
  assert.equal(detect('https://m.facebook.com/video'), 'Facebook');
  assert.equal(detect('https://vm.tiktok.com/example'), 'TikTok');
  assert.equal(detect('https://x.com/user/status/1'), 'X/Twitter');
});

test('public platform registry rejects lookalike domains', () => {
  assert.equal(detect('https://youtube.com.evil.example/video'), null);
  assert.equal(detect('https://notyoutube.com/video'), null);
  assert.equal(detect('https://evil.example/?next=https://youtube.com'), null);
});
