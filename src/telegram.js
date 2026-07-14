import fs from 'node:fs';
import crypto from 'node:crypto';
import { Telegraf, Input } from 'telegraf';
import { config } from './config.js';
import { validateMediaUrl } from './url-validator.js';
import { downloadMedia } from './downloader.js';
import { runDownloadJob } from './download-queue.js';
import { activeTelegramVideoJobCount, getTelegramVideoJob, telegramVideoJobCountToday } from './db.js';
import { createNineRouterVideo, listNineRouterVideoModels, refreshNineRouterVideo } from './nine-router-video.js';
import { parseTelegramVeoCommand, validateVideoParameters } from './video-parameters.js';

const bot = config.botToken ? new Telegraf(config.botToken) : null;
let mode = bot ? 'starting' : 'disabled';
let startupError = '';
let pollingStarted = false;
let webhookCheckedAt = 0;
let webhookVerification = null;
let mutation = Promise.resolve();
const cooldowns = new Map();
const veoStatusChecks = new Map();
const TERMINAL_VIDEO_STATUSES = new Set(['completed', 'failed', 'cancelled', 'expired']);
const WEBHOOK_VERIFICATION_TTL_MS = 60_000;

function safeMessage(error, fallback) {
  const message = String(error?.message || fallback).replace(/https?:\/\/\S+/gi, '[url]').replace(/bot\d+:[A-Za-z0-9_-]+/g, '[token]');
  return message.slice(0, 240);
}

function withMutation(task) {
  const operation = mutation.then(task, task);
  mutation = operation.catch(() => {});
  return operation;
}

function normalizeWebhookInfo(info = {}) {
  return {
    url: String(info.url || '').slice(0, 500),
    hasCustomCertificate: Boolean(info.has_custom_certificate),
    pendingUpdateCount: Number.isSafeInteger(info.pending_update_count) ? info.pending_update_count : 0,
    ipAddress: String(info.ip_address || '').slice(0, 64),
    lastErrorDate: Number.isSafeInteger(info.last_error_date) ? new Date(info.last_error_date * 1000).toISOString() : '',
    lastErrorMessage: String(info.last_error_message || '').slice(0, 300),
    maxConnections: Number.isSafeInteger(info.max_connections) ? info.max_connections : null,
    allowedUpdates: Array.isArray(info.allowed_updates) ? info.allowed_updates.map(String).slice(0, 30) : [],
  };
}

function telegramVeoIdentity(ctx) {
  const userId = ctx.from?.id ? String(ctx.from.id) : '';
  if (!userId || ctx.chat?.type !== 'private' || !config.telegramVeoAllowedUserIds.has(userId)) return null;
  return { userId, chatId: String(ctx.chat.id) };
}

function commandPayload(ctx) {
  if (typeof ctx.payload === 'string') return ctx.payload.trim();
  return String(ctx.message?.text || '').replace(/^\/\w+(?:@\w+)?\s*/u, '').trim();
}

function videoStatusText(job) {
  const status = String(job.status || 'processing');
  if (status === 'completed') return job.output_url ? `✅ Job video #${job.id} selesai. Mengirim hasil...` : `✅ Job video #${job.id} selesai, tetapi URL hasil belum diberikan provider.`;
  if (TERMINAL_VIDEO_STATUSES.has(status)) return `❌ Job video #${job.id} berstatus ${status}. ${safeMessage(job.error, '').trim()}`.trim();
  return `⏳ Job video #${job.id}: ${status}. Jalankan /veostatus ${job.id} setelah sekitar 15 detik.`;
}

async function deliverVideoResult(ctx, job) {
  if (!job.output_url) return;
  try {
    await ctx.replyWithVideo(Input.fromURL(job.output_url), { caption: `✅ Video AI job #${job.id}` });
  } catch {
    try {
      await ctx.replyWithDocument(Input.fromURL(job.output_url), { caption: `✅ Video AI job #${job.id}` });
    } catch {
      await ctx.reply(`✅ Video AI job #${job.id} siap. Unduh melalui URL berikut:\n${job.output_url}`, { link_preview_options: { is_disabled: true } });
    }
  }
}

async function requireTelegramVeoAccess(ctx) {
  const identity = telegramVeoIdentity(ctx);
  if (identity) return identity;
  await ctx.reply('Perintah tidak tersedia.').catch(() => {});
  return null;
}

async function handleVeoCommand(ctx) {
  const identity = await requireTelegramVeoAccess(ctx);
  if (!identity) return;
  try {
    if (activeTelegramVideoJobCount(identity.userId) >= config.telegramVeoMaxActivePerUser) {
      throw new Error('Masih ada job video aktif. Periksa dengan /veostatus <id>.');
    }
    if (telegramVideoJobCountToday(identity.userId) >= config.telegramVeoDailyLimit) {
      throw new Error('Kuota pembuatan video hari ini telah tercapai.');
    }
    const parsed = parseTelegramVeoCommand(commandPayload(ctx));
    const models = await listNineRouterVideoModels();
    const parameters = validateVideoParameters(parsed, models.map(({ id }) => id));
    const job = await createNineRouterVideo({ ...parameters, source: 'telegram', telegramUserId: identity.userId, telegramChatId: identity.chatId });
    await ctx.reply(videoStatusText(job));
    if (job.status === 'completed') await deliverVideoResult(ctx, job);
  } catch (error) {
    await ctx.reply(`❌ ${safeMessage(error, 'Job video gagal dibuat.')}`).catch(() => {});
  }
}

async function handleVeoStatusCommand(ctx) {
  const identity = await requireTelegramVeoAccess(ctx);
  if (!identity) return;
  try {
    const value = commandPayload(ctx);
    if (!/^\d{1,15}$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) throw new Error('Gunakan format: /veostatus <nomor-job>.');
    let job = getTelegramVideoJob(Number(value), identity.userId);
    if (!job) throw new Error('Job video tidak ditemukan.');
    if (!TERMINAL_VIDEO_STATUSES.has(job.status)) {
      const key = `${identity.userId}:${job.id}`;
      const now = Date.now();
      const retryAt = veoStatusChecks.get(key) || 0;
      if (retryAt > now) throw new Error(`Tunggu ${Math.ceil((retryAt - now) / 1000)} detik sebelum memeriksa job ini lagi.`);
      veoStatusChecks.set(key, now + config.telegramVeoStatusCooldownSeconds * 1000);
      job = await refreshNineRouterVideo(job.id);
    }
    await ctx.reply(videoStatusText(job));
    if (job.status === 'completed') await deliverVideoResult(ctx, job);
    if (veoStatusChecks.size > 10_000) {
      const now = Date.now();
      for (const [key, expiresAt] of veoStatusChecks) if (expiresAt <= now) veoStatusChecks.delete(key);
    }
  } catch (error) {
    await ctx.reply(`❌ ${safeMessage(error, 'Status job video gagal diperiksa.')}`).catch(() => {});
  }
}

function registerHandlers(instance) {
  instance.start((ctx) => ctx.reply(`Selamat datang di ${config.name}!\n\nKirim link publik Facebook, Instagram, TikTok, YouTube, atau X. Pastikan Anda berhak mengunduh konten tersebut.`));
  instance.help((ctx) => {
    const veoHelp = telegramVeoIdentity(ctx) ? '\n\nVeo (khusus akses diizinkan): /veo <prompt> dan /veostatus <nomor-job>.' : '';
    return ctx.reply(`Cukup kirim satu URL publik. Konten privat, DRM, playlist, dan bypass akses tidak didukung.${veoHelp}`);
  });
  instance.command('veo', handleVeoCommand);
  instance.command('veostatus', handleVeoStatusCommand);
  instance.on('text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) return;
    const userId = String(ctx.from?.id || ctx.chat?.id || 'unknown');
    const now = Date.now();
    if ((cooldowns.get(userId) || 0) > now) {
      await ctx.reply('Terlalu cepat. Tunggu sebentar sebelum mengirim link berikutnya.').catch(() => {});
      return;
    }
    cooldowns.set(userId, now + config.telegramCooldownSeconds * 1000);
    let status = null;
    let filePath = '';
    try {
      status = await ctx.reply('🔎 Memeriksa link...');
      const media = await validateMediaUrl(ctx.message.text);
      await ctx.telegram.editMessageText(ctx.chat.id, status.message_id, undefined, `⏳ Mengunduh dari ${media.platform}...`);
      const result = await runDownloadJob({ source: 'telegram', userRef: userId }, () => downloadMedia({ ...media, source: 'telegram', userRef: userId }));
      filePath = result.filePath;
      await ctx.replyWithDocument(Input.fromLocalFile(result.filePath, result.fileName), { caption: `✅ Selesai melalui ${config.name}` });
      await ctx.telegram.deleteMessage(ctx.chat.id, status.message_id).catch(() => {});
    } catch (error) {
      const message = safeMessage(error, 'Download gagal.');
      if (status) await ctx.telegram.editMessageText(ctx.chat.id, status.message_id, undefined, `❌ ${message}`).catch(() => {});
      else await ctx.reply(`❌ ${message}`).catch(() => {});
    } finally {
      if (filePath) fs.rm(filePath, { force: true }, () => {});
      if (cooldowns.size > 10_000) {
        for (const [key, expiresAt] of cooldowns) if (expiresAt <= Date.now()) cooldowns.delete(key);
      }
    }
  });
  instance.catch((error) => console.error('Telegram:', safeMessage(error, 'Kesalahan Telegram')));
}

if (bot) registerHandlers(bot);

export function hasTelegramBot() {
  return Boolean(bot);
}

export function derivePublicTelegramInfo({ username = '', runtimeMode = '', isPolling = false, error = '' } = {}) {
  const safeUsername = String(username);
  const validUsername = /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(safeUsername);
  const active = (runtimeMode === 'polling' && isPolling) || runtimeMode === 'webhook';
  if (!validUsername || error || !active) return { active: false, username: '', url: '' };
  return { active: true, username: safeUsername, url: `https://t.me/${safeUsername}` };
}

export async function getPublicTelegramInfo() {
  if (config.telegramMode === 'webhook' && Date.now() - webhookCheckedAt >= WEBHOOK_VERIFICATION_TTL_MS) await revalidateWebhook();
  return derivePublicTelegramInfo({ username: bot?.botInfo?.username, runtimeMode: mode, isPolling: pollingStarted, error: startupError });
}

export function telegramWebhookUrl() {
  return config.telegramMode === 'webhook' ? new URL(config.telegramWebhookPath, `${config.appUrl}/`).href : '';
}

async function revalidateWebhook({ force = false } = {}) {
  if (!bot || config.telegramMode !== 'webhook') return false;
  if (!force && Date.now() - webhookCheckedAt < WEBHOOK_VERIFICATION_TTL_MS) return mode === 'webhook';
  if (webhookVerification) return webhookVerification;
  webhookVerification = bot.telegram.getWebhookInfo()
    .then((info) => {
      const verified = safeUrlEqual(info.url, telegramWebhookUrl());
      mode = verified ? 'webhook' : 'webhook-unset';
      startupError = '';
      webhookCheckedAt = Date.now();
      return verified;
    })
    .catch((error) => {
      mode = 'error';
      startupError = safeMessage(error, 'Webhook Telegram tidak dapat diverifikasi.');
      webhookCheckedAt = Date.now();
      return false;
    })
    .finally(() => { webhookVerification = null; });
  return webhookVerification;
}

export async function startTelegram() {
  if (!bot || config.telegramMode === 'disabled') {
    mode = 'disabled';
    startupError = '';
    return { mode };
  }
  try {
    bot.botInfo = await bot.telegram.getMe();
    if (config.telegramMode === 'webhook') {
      await revalidateWebhook({ force: true });
      return { mode, botInfo: bot.botInfo };
    }
    await bot.telegram.deleteWebhook({ drop_pending_updates: false });
    mode = 'polling';
    startupError = '';
    pollingStarted = true;
    void bot.startPolling(['message']).catch((error) => {
      pollingStarted = false;
      mode = 'error';
      startupError = safeMessage(error, 'Polling Telegram berhenti.');
      console.error('Telegram polling:', startupError);
    });
    return { mode, botInfo: bot.botInfo };
  } catch (error) {
    mode = 'error';
    startupError = safeMessage(error, 'Telegram gagal dimulai.');
    console.error('Telegram startup:', startupError);
    return { mode, error: startupError };
  }
}

export function telegramWebhookMiddleware() {
  if (!bot || config.telegramMode !== 'webhook') return null;
  const callback = bot.webhookCallback('/', { secretToken: config.telegramWebhookSecret });
  return (req, res) => {
    const originalUrl = req.url;
    req.url = '/';
    Promise.resolve(callback(req, res)).finally(() => { req.url = originalUrl; });
  };
}

export async function getTelegramStatus() {
  if (!bot) return { configured: false, mode: 'disabled', startupError: '' };
  if (config.telegramMode === 'disabled') {
    return { configured: true, mode: 'disabled', startupError: '', bot: null, expectedWebhookUrl: '', webhook: null };
  }
  try {
    const [me, webhook] = await Promise.all([bot.telegram.getMe(), bot.telegram.getWebhookInfo()]);
    if (config.telegramMode === 'webhook') {
      const verified = safeUrlEqual(webhook.url, telegramWebhookUrl());
      mode = verified ? 'webhook' : 'webhook-unset';
      startupError = '';
      webhookCheckedAt = Date.now();
    }
    return {
      configured: true,
      mode,
      startupError,
      bot: { id: String(me.id), username: String(me.username || '').slice(0, 64), name: String(me.first_name || '').slice(0, 100) },
      expectedWebhookUrl: telegramWebhookUrl(),
      webhook: normalizeWebhookInfo(webhook),
    };
  } catch (error) {
    if (config.telegramMode === 'webhook') {
      mode = 'error';
      startupError = safeMessage(error, 'Status Telegram tidak dapat diambil.');
      webhookCheckedAt = Date.now();
    }
    return { configured: true, mode, startupError: safeMessage(error, 'Status Telegram tidak dapat diambil.'), bot: null, expectedWebhookUrl: telegramWebhookUrl(), webhook: null };
  }
}

export async function setTelegramWebhook({ dropPendingUpdates = false } = {}) {
  return withMutation(async () => {
    if (!bot) throw new Error('Token bot Telegram belum dikonfigurasi.');
    if (config.telegramMode !== 'webhook') throw new Error('TELEGRAM_MODE harus webhook. Ubah melalui installer lalu restart service.');
    const url = telegramWebhookUrl();
    await bot.telegram.setWebhook(url, {
      secret_token: config.telegramWebhookSecret,
      allowed_updates: ['message'],
      max_connections: config.telegramWebhookMaxConnections,
      drop_pending_updates: Boolean(dropPendingUpdates),
    });
    const info = await bot.telegram.getWebhookInfo();
    if (!safeUrlEqual(info.url, url)) throw new Error('Telegram tidak mengonfirmasi URL webhook yang dikonfigurasi.');
    mode = 'webhook';
    startupError = '';
    webhookCheckedAt = Date.now();
    console.info('Telegram webhook disetel oleh admin.');
    return normalizeWebhookInfo(info);
  });
}

export async function deleteTelegramWebhook({ dropPendingUpdates = false } = {}) {
  return withMutation(async () => {
    if (!bot) throw new Error('Token bot Telegram belum dikonfigurasi.');
    await bot.telegram.deleteWebhook({ drop_pending_updates: Boolean(dropPendingUpdates) });
    const info = await bot.telegram.getWebhookInfo();
    if (info.url) throw new Error('Telegram masih melaporkan webhook aktif.');
    mode = config.telegramMode === 'polling' ? 'polling' : 'webhook-unset';
    webhookCheckedAt = 0;
    console.info('Telegram webhook dihapus oleh admin.');
    return normalizeWebhookInfo(info);
  });
}

function safeUrlEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function stopTelegram() {
  if (!bot || !pollingStarted) return;
  try { bot.stop('shutdown'); } catch (error) { console.error('Telegram shutdown:', safeMessage(error, 'Gagal menghentikan Telegram.')); }
  pollingStarted = false;
}
