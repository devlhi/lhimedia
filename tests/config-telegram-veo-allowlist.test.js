import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const configUrl = new URL('../src/config.js', import.meta.url).href;

function loadConfig(env) {
  return spawnSync(process.execPath, ['--input-type=module', '--eval', `import(${JSON.stringify(configUrl)}).then(({config}) => console.log([...config.telegramVeoAllowedUserIds].join('|')))`], {
    env: { ...process.env, PORT: '3100', TELEGRAM_VEO_ALLOWED_USER_IDS: '', ...env }, encoding: 'utf8',
  });
}

test('Telegram Veo allowlist preserves numeric IDs as strings', () => {
  const result = loadConfig({ TELEGRAM_VEO_ALLOWED_USER_IDS: '123456789,9007199254740993' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), '123456789|9007199254740993');
});

test('Telegram Veo allowlist rejects malformed and duplicate IDs', () => {
  for (const value of ['0', '-1', '1e6', '123.4', '123,123', '123, abc']) {
    const result = loadConfig({ TELEGRAM_VEO_ALLOWED_USER_IDS: value });
    assert.notEqual(result.status, 0, value);
    assert.match(`${result.stdout}\n${result.stderr}`, /TELEGRAM_VEO_ALLOWED_USER_IDS/);
  }
});

test('empty Telegram Veo allowlist disables commands', () => {
  const result = loadConfig({ TELEGRAM_VEO_ALLOWED_USER_IDS: '  ' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), '');
});
