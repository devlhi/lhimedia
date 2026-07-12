import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_VIDEO_MODEL, parseTelegramVeoCommand, validateVideoParameters } from '../src/video-parameters.js';

const models = [DEFAULT_VIDEO_MODEL, 'video/custom-v1'];

test('Telegram Veo parser applies safe defaults', () => {
  assert.deepEqual(parseTelegramVeoCommand('Buat pemandangan pantai saat matahari terbenam'), {
    model: DEFAULT_VIDEO_MODEL,
    duration: 8,
    resolution: '1080p',
    aspectRatio: '16:9',
    generateAudio: false,
    prompt: 'Buat pemandangan pantai saat matahari terbenam',
  });
});

test('Telegram Veo parser accepts explicit options at command start', () => {
  assert.deepEqual(parseTelegramVeoCommand('--model=video/custom-v1 --duration=4 --resolution=720p --ratio=9:16 --audio=true Buat video vertikal yang menarik'), {
    model: 'video/custom-v1', duration: 4, resolution: '720p', aspectRatio: '9:16', generateAudio: true,
    prompt: 'Buat video vertikal yang menarik',
  });
});

test('Telegram Veo parser rejects unknown, duplicate, and malformed options', () => {
  assert.throws(() => parseTelegramVeoCommand('--unknown=x prompt panjang sekali'), /tidak didukung/);
  assert.throws(() => parseTelegramVeoCommand('--duration=4 --duration=8 prompt panjang sekali'), /tidak boleh diulang/);
  assert.throws(() => parseTelegramVeoCommand('--audio=yes prompt panjang sekali'), /tidak didukung/);
  assert.throws(() => parseTelegramVeoCommand('--duration prompt panjang sekali'), /format/);
});

test('shared video validation enforces prompt, model, and option allowlists', () => {
  const valid = parseTelegramVeoCommand('Buat animasi awan bergerak perlahan');
  assert.equal(validateVideoParameters(valid, models).model, DEFAULT_VIDEO_MODEL);
  assert.throws(() => validateVideoParameters({ ...valid, prompt: 'pendek' }, models), /10–2000/);
  assert.throws(() => validateVideoParameters({ ...valid, model: 'other' }, models), /Model video/);
  assert.throws(() => validateVideoParameters({ ...valid, duration: 5 }, models), /Parameter video/);
  assert.throws(() => validateVideoParameters({ ...valid, resolution: '4k' }, models), /Parameter video/);
  assert.throws(() => validateVideoParameters({ ...valid, aspectRatio: '1:1' }, models), /Parameter video/);
});
