import test from 'node:test';
import assert from 'node:assert/strict';
import { derivePublicTelegramInfo } from '../src/telegram.js';

const inactive = { active: false, username: '', url: '' };

test('public Telegram info only exposes active polling and verified webhook modes', () => {
  assert.deepEqual(derivePublicTelegramInfo({ username: 'BotLink_bot', runtimeMode: 'polling', isPolling: true }), {
    active: true,
    username: 'BotLink_bot',
    url: 'https://t.me/BotLink_bot',
  });
  assert.equal(derivePublicTelegramInfo({ username: 'BotLink_bot', runtimeMode: 'webhook' }).active, true);
});

test('public Telegram info fails closed for inactive, error, and invalid states', () => {
  assert.deepEqual(derivePublicTelegramInfo({ username: 'BotLink_bot', runtimeMode: 'starting' }), inactive);
  assert.deepEqual(derivePublicTelegramInfo({ username: 'BotLink_bot', runtimeMode: 'polling', isPolling: false }), inactive);
  assert.deepEqual(derivePublicTelegramInfo({ username: 'BotLink_bot', runtimeMode: 'webhook-unset' }), inactive);
  assert.deepEqual(derivePublicTelegramInfo({ username: 'bad-user!', runtimeMode: 'webhook' }), inactive);
  assert.deepEqual(derivePublicTelegramInfo({ username: 'BotLink_bot', runtimeMode: 'webhook', error: 'unavailable' }), inactive);
});
