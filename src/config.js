import 'dotenv/config';
import path from 'node:path';

function integer(name, fallback, minimum, maximum) {
  const raw = String(process.env[name] ?? fallback);
  if (!/^\d+$/.test(raw)) throw new Error(`${name} harus berupa bilangan bulat.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${name} harus antara ${minimum} dan ${maximum}.`);
  return value;
}

function enumValue(name, fallback, allowed) {
  const value = String(process.env[name] || fallback).toLowerCase();
  if (!allowed.includes(value)) throw new Error(`${name} harus salah satu dari: ${allowed.join(', ')}.`);
  return value;
}

function applicationUrl() {
  const value = String(process.env.APP_URL || 'http://localhost:3100').replace(/\/+$/, '');
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('APP_URL tidak valid.'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('APP_URL harus HTTP(S) tanpa credential, query, atau fragment.');
  return parsed.href.replace(/\/$/, '');
}

function webhookPath() {
  const value = String(process.env.TELEGRAM_WEBHOOK_PATH || '');
  if (!value) return '';
  if (!/^\/telegram\/webhook\/[A-Za-z0-9_-]{24,128}$/.test(value)) throw new Error('TELEGRAM_WEBHOOK_PATH tidak valid. Buat ulang melalui installer.');
  return value;
}

function telegramUserIds(name) {
  const raw = String(process.env[name] || '').trim();
  if (!raw) return new Set();
  const values = raw.split(',').map((value) => value.trim());
  if (values.some((value) => !/^[1-9]\d{0,19}$/.test(value)) || new Set(values).size !== values.length) {
    throw new Error(`${name} harus berisi ID Telegram numerik unik yang dipisahkan koma.`);
  }
  return new Set(values);
}

const isProduction = process.env.NODE_ENV === 'production';
const telegramMode = enumValue('TELEGRAM_MODE', 'polling', ['disabled', 'polling', 'webhook']);
const appUrl = applicationUrl();
const telegramWebhookPath = webhookPath();
const telegramWebhookSecret = String(process.env.TELEGRAM_WEBHOOK_SECRET || '');
if (telegramMode === 'webhook' && (!String(process.env.TELEGRAM_BOT_TOKEN || '') || !telegramWebhookPath || !/^[A-Za-z0-9_-]{32,256}$/.test(telegramWebhookSecret) || !appUrl.startsWith('https://'))) {
  throw new Error('Mode webhook Telegram membutuhkan token, APP_URL HTTPS, path, dan secret yang aman.');
}

export const config = {
  name: String(process.env.APP_NAME || 'BotLink').slice(0, 100),
  port: integer('PORT', 3100, 1024, 65535),
  appUrl,
  botToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramMode,
  telegramWebhookPath,
  telegramWebhookSecret,
  telegramWebhookMaxConnections: integer('TELEGRAM_WEBHOOK_MAX_CONNECTIONS', 20, 1, 100),
  telegramCooldownSeconds: integer('TELEGRAM_COOLDOWN_SECONDS', 30, 5, 3600),
  telegramVeoAllowedUserIds: telegramUserIds('TELEGRAM_VEO_ALLOWED_USER_IDS'),
  telegramVeoMaxActivePerUser: integer('TELEGRAM_VEO_MAX_ACTIVE_PER_USER', 1, 1, 2),
  telegramVeoDailyLimit: integer('TELEGRAM_VEO_DAILY_LIMIT', 3, 1, 100),
  telegramVeoStatusCooldownSeconds: integer('TELEGRAM_VEO_STATUS_COOLDOWN_SECONDS', 15, 10, 300),
  adminUsername: process.env.ADMIN_USERNAME || '',
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH || '',
  sessionSecret: process.env.SESSION_SECRET || '',
  encryptionKey: process.env.SETTINGS_ENCRYPTION_KEY || '',
  nineRouterApiUrl: String(process.env.NINE_ROUTER_API_URL || '').replace(/\/+$/, ''),
  nineRouterApiKey: process.env.NINE_ROUTER_API_KEY || '',
  nineRouterVideoEndpoint: String(process.env.NINE_ROUTER_VIDEO_ENDPOINT || 'videos').replace(/^\/+|\/+$/g, ''),
  isProduction,
  maxFileMb: integer('MAX_FILE_SIZE_MB', 45, 1, 2000),
  timeoutMs: integer('DOWNLOAD_TIMEOUT_SECONDS', 180, 10, 3600) * 1000,
  cleanupMinutes: integer('CLEANUP_AFTER_MINUTES', 30, 1, 1440),
  downloadConcurrency: integer('DOWNLOAD_CONCURRENCY', 2, 1, 10),
  downloadQueueLimit: integer('DOWNLOAD_QUEUE_LIMIT', 20, 1, 1000),
  ytdlpBinary: process.env.YTDLP_BINARY || path.resolve('bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'),
  tempDir: path.resolve('storage', 'tmp'),
  dbPath: path.resolve('data', 'botlink.db'),
};
