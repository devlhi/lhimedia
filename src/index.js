import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { validateMediaUrl } from './url-validator.js';
import { downloadMedia } from './downloader.js';
import { recentDownloads, recentVideoJobs, SQLiteSessionStore, stats } from './db.js';
import { verifyPassword } from './password.js';
import { createNineRouterVideo, hasNineRouterKey, listNineRouterVideoModels, refreshNineRouterVideo } from './nine-router-video.js';
import { getDownloadQueueStatus, runDownloadJob } from './download-queue.js';
import { deleteTelegramWebhook, getTelegramStatus, setTelegramWebhook, startTelegram, stopTelegram, telegramWebhookMiddleware } from './telegram.js';
import { validateVideoParameters } from './video-parameters.js';

const forbiddenSecretParts = ['ubah-', 'ganti-', 'change-me', 'password', 'secret'];
const validPasswordHash = /^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/i.test(config.adminPasswordHash);
if (!/^[A-Za-z0-9._-]{3,64}$/.test(config.adminUsername) || !validPasswordHash || config.sessionSecret.length < 32 || config.encryptionKey.length < 32
  || config.sessionSecret === config.encryptionKey || forbiddenSecretParts.some((part) => config.sessionSecret.toLowerCase().includes(part) || config.encryptionKey.toLowerCase().includes(part))) {
  throw new Error('Konfigurasi admin dan secret tidak aman. Jalankan install-ubuntu.sh atau periksa .env.');
}

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.resolve('views'));
app.disable('x-powered-by');
if (config.isProduction) app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: { directives: { 'script-src': ["'self'"], 'style-src': ["'self'", 'https://fonts.googleapis.com'], 'font-src': ["'self'", 'https://fonts.gstatic.com'] } } }));
const webhookMiddleware = telegramWebhookMiddleware();
if (webhookMiddleware) app.post(config.telegramWebhookPath, express.json({ limit: '256kb', type: 'application/json' }), webhookMiddleware);
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(express.static(path.resolve('public'), { maxAge: '1d' }));
app.use(session({
  name: 'botlink.admin',
  secret: config.sessionSecret,
  store: new SQLiteSessionStore(),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'strict', secure: config.isProduction, maxAge: 8 * 60 * 60_000 },
}));
app.use((req, res, next) => {
  res.locals.appName = config.name;
  res.locals.path = req.path;
  res.locals.isAdmin = Boolean(req.session.admin);
  res.locals.csrfToken = req.session.csrfToken || '';
  next();
});
const downloadLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, message: 'Terlalu banyak permintaan. Coba lagi nanti.' });
const aiLimiter = rateLimit({ windowMs: 24 * 60 * 60_000, limit: 10, keyGenerator: (req) => req.sessionID, standardHeaders: 'draft-8', legacyHeaders: false, message: 'Batas harian generasi video tercapai.' });
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false });

app.get('/', (req, res) => res.render('index', { platforms: ['Facebook', 'Instagram', 'TikTok', 'YouTube', 'X'] }));
app.post('/download', downloadLimiter, async (req, res) => {
  try {
    const media = await validateMediaUrl(req.body.url);
    const result = await runDownloadJob({ source: 'web', userRef: req.ip }, () => downloadMedia({ ...media, source: 'web', userRef: req.ip }));
    res.download(result.filePath, result.fileName, () => fs.rm(result.filePath, { force: true }, () => {}));
  } catch (error) { res.status(422).render('error', { message: String(error?.message || 'Download gagal.').slice(0, 240) }); }
});

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function requireAdmin(req, res, next) {
  if (req.session.admin) return next();
  return res.status(401).render('admin-login', { message: '' });
}
app.use('/admin', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.get('/admin/login', (req, res) => req.session.admin ? res.redirect('/admin') : res.render('admin-login', { message: '' }));
app.post('/admin/login', loginLimiter, (req, res, next) => {
  const usernameMatches = safeEqual(req.body.username || '', config.adminUsername);
  const passwordMatches = verifyPassword(req.body.password || '', config.adminPasswordHash);
  if (!usernameMatches || !passwordMatches) return res.status(401).render('admin-login', { message: 'Username atau password salah.' });
  req.session.regenerate((error) => {
    if (error) return next(error);
    req.session.admin = true;
    req.session.adminUsername = config.adminUsername;
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    req.session.save((saveError) => saveError ? next(saveError) : res.redirect('/admin'));
  });
});
app.post('/admin/logout', requireAdmin, (req, res, next) => {
  if (!safeEqual(req.body.csrf || '', req.session.csrfToken || '')) return res.sendStatus(403);
  req.session.destroy((error) => error ? next(error) : res.redirect('/admin/login'));
});
app.use('/admin', requireAdmin);
app.use('/admin', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.locals.csrfToken = req.session.csrfToken;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !safeEqual(req.body.csrf || '', req.session.csrfToken || '')) return res.sendStatus(403);
  next();
});
const telegramAdminLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, keyGenerator: (req) => req.sessionID, standardHeaders: 'draft-8', legacyHeaders: false });
app.get('/admin', (req, res) => res.render('admin', { downloads: recentDownloads(), stats: stats(), videoJobs: recentVideoJobs(5), queue: getDownloadQueueStatus() }));
app.get('/admin/telegram', async (req, res) => {
  const status = await getTelegramStatus();
  res.render('admin-telegram', { status, telegramMode: config.telegramMode, message: String(req.query.message || '').slice(0, 240) });
});
app.post('/admin/telegram/webhook/set', telegramAdminLimiter, async (req, res) => {
  try {
    await setTelegramWebhook({ dropPendingUpdates: req.body.dropPendingUpdates === '1' });
    res.redirect('/admin/telegram?message=' + encodeURIComponent('Webhook Telegram berhasil disetel dan diverifikasi.'));
  } catch (error) { res.status(422).render('error', { message: String(error?.message || 'Webhook gagal disetel.').slice(0, 240) }); }
});
app.post('/admin/telegram/webhook/delete', telegramAdminLimiter, async (req, res) => {
  try {
    await deleteTelegramWebhook({ dropPendingUpdates: req.body.dropPendingUpdates === '1' });
    res.redirect('/admin/telegram?message=' + encodeURIComponent('Webhook Telegram berhasil dihapus.'));
  } catch (error) { res.status(422).render('error', { message: String(error?.message || 'Webhook gagal dihapus.').slice(0, 240) }); }
});
app.get('/admin/ai', async (req, res) => {
  let models = [];
  let message = String(req.query.message || '');
  try { models = await listNineRouterVideoModels(); } catch (error) { message ||= error.message; }
  res.render('admin-ai', {
    configured: hasNineRouterKey(),
    keyHint: config.nineRouterApiKey ? `••••${config.nineRouterApiKey.slice(-4)}` : '',
    models,
    jobs: recentVideoJobs(),
    message,
  });
});
app.post('/admin/ai/generate', aiLimiter, async (req, res) => {
  try {
    const allowedModels = (await listNineRouterVideoModels()).map(({ id }) => id);
    const parameters = validateVideoParameters({
      model: req.body.model,
      prompt: req.body.prompt,
      duration: req.body.duration,
      resolution: req.body.resolution,
      aspectRatio: req.body.aspectRatio,
      generateAudio: req.body.generateAudio === '1',
    }, allowedModels);
    const job = await createNineRouterVideo(parameters);
    res.redirect(`/admin/ai?message=${encodeURIComponent(`Job #${job.id} berhasil dikirim`)}`);
  } catch (error) { res.status(422).render('error', { message: error.message || 'Pembuatan video gagal.' }); }
});
app.post('/admin/ai/jobs/:id/refresh', async (req, res) => {
  try {
    const jobId = Number(req.params.id);
    if (!Number.isSafeInteger(jobId) || jobId < 1) throw new Error('ID job video tidak valid.');
    await refreshNineRouterVideo(jobId);
    res.redirect('/admin/ai');
  } catch (error) { res.status(422).render('error', { message: error.message || 'Pemeriksaan status gagal.' }); }
});
app.use((req, res) => res.status(404).render('error', { message: 'Halaman tidak ditemukan.' }));
app.use((error, req, res, next) => {
  console.error('Kesalahan internal:', error?.name || 'Error', String(error?.message || '').slice(0, 300));
  if (res.headersSent) return next(error);
  const status = error?.type === 'entity.too.large' || error?.status === 413 ? 413 : 500;
  res.locals.appName ??= config.name;
  res.locals.path ??= req.path;
  res.locals.isAdmin ??= Boolean(req.session?.admin);
  res.locals.csrfToken ??= req.session?.csrfToken || '';
  res.status(status).render('error', { message: status === 413 ? 'Request terlalu besar.' : 'Terjadi kesalahan internal.' });
});

const server = app.listen(config.port, () => console.log(`${config.name} aktif di ${config.appUrl}`));
await startTelegram();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  stopTelegram();
  server.close(() => process.exit(0));
});
