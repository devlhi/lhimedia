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

test('configuration only allows loopback listener addresses', () => {
  for (const value of ['0.0.0.0', '192.168.1.10', 'example.com']) {
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `import(${JSON.stringify(configUrl)})`], {
      env: { ...process.env, PORT: '3100', BIND_HOST: value }, encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, value);
    assert.match(`${result.stdout}\n${result.stderr}`, /BIND_HOST hanya boleh berupa alamat loopback/);
  }
});

test('configuration accepts documented loopback listener addresses', () => {
  for (const value of ['127.0.0.1', '::1', 'localhost']) {
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `import(${JSON.stringify(configUrl)}).then(({ config }) => console.log(config.bindHost))`], {
      env: { ...process.env, PORT: '3100', BIND_HOST: value }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, `${value}: ${result.stderr}`);
    assert.equal(result.stdout.trim(), value);
  }
});
