import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const configUrl = new URL('../src/config.js', import.meta.url).href;

test('configuration rejects non-numeric integers', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `import(${JSON.stringify(configUrl)})`], {
    env: { ...process.env, PORT: 'not-a-number' }, encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /PORT harus berupa bilangan bulat/);
});

test('webhook mode rejects insecure configuration', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `import(${JSON.stringify(configUrl)})`], {
    env: { ...process.env, PORT: '3100', TELEGRAM_MODE: 'webhook', TELEGRAM_BOT_TOKEN: 'token', APP_URL: 'http://example.test', TELEGRAM_WEBHOOK_PATH: '', TELEGRAM_WEBHOOK_SECRET: '' }, encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Mode webhook Telegram membutuhkan/);
});
