import { config } from './config.js';
import { activeVideoJobCount, createVideoJob, expireStaleVideoJobs, getVideoJob, updateVideoJob } from './db.js';
import { DEFAULT_VIDEO_MODEL } from './video-parameters.js';

const MAX_ACTIVE_VIDEO_JOBS = 2;
const MAX_PROVIDER_RESPONSE_BYTES = 512 * 1024;
expireStaleVideoJobs('9router');
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'expired', 'succeeded', 'success']);
const ALLOWED_STATUSES = new Set(['queued', 'pending', 'processing', 'running', 'completed', 'failed', 'cancelled', 'expired']);
let generationRequestInFlight = false;

function videoEndpoint() {
  if (!config.nineRouterVideoEndpoint || config.nineRouterVideoEndpoint.includes('..') || !/^[A-Za-z0-9._~!$&'()*+,;=:@/-]+$/.test(config.nineRouterVideoEndpoint)) {
    throw new Error('Endpoint video 9Router tidak valid.');
  }
  return config.nineRouterVideoEndpoint;
}

function apiBase() {
  if (!config.nineRouterApiUrl || !config.nineRouterApiKey) {
    throw new Error('API 9Router belum dikonfigurasi. Jalankan kembali installer Ubuntu.');
  }
  let url;
  try { url = new URL(config.nineRouterApiUrl); } catch { throw new Error('Base URL API 9Router tidak valid.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('Base URL API 9Router harus berupa HTTPS tanpa credential, query, atau fragment.');
  }
  return url;
}

function providerUrl(path) {
  const base = apiBase();
  const basePath = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
  const url = new URL(base);
  url.pathname = `${basePath}${String(path).replace(/^\//, '')}`;
  return url;
}

function isProviderUrl(value) {
  try {
    const base = apiBase();
    const url = new URL(value, base);
    const basePath = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
    return url.protocol === 'https:' && url.origin === base.origin && (url.pathname === base.pathname || url.pathname.startsWith(basePath));
  } catch { return false; }
}

function safeError(error) {
  const message = String(error?.message || error || 'Kesalahan provider.');
  return message.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]').replace(/[?&](key|token|api_key)=[^&\s]+/gi, '$1=[REDACTED]').slice(0, 500);
}

async function request(pathOrUrl, options = {}) {
  const url = pathOrUrl instanceof URL ? pathOrUrl : providerUrl(pathOrUrl);
  if (!isProviderUrl(url)) throw new Error('URL API provider tidak diizinkan.');
  const response = await fetch(url, {
    ...options,
    redirect: 'manual',
    headers: {
      Authorization: `Bearer ${config.nineRouterApiKey}`,
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status >= 300 && response.status < 400) throw new Error('API 9Router mengembalikan redirect yang tidak diizinkan.');
  if (!response.ok) throw new Error(`API 9Router menolak permintaan (${response.status}).`);
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new Error('Respons API 9Router tidak valid atau terlalu besar.');
  }
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length > MAX_PROVIDER_RESPONSE_BYTES) throw new Error('Respons API 9Router terlalu besar.');
  try { return JSON.parse(body.toString('utf8')); }
  catch { throw new Error('Respons API 9Router bukan JSON valid.'); }
}

function normalizedJob(payload) {
  const data = payload?.data && !Array.isArray(payload.data) ? payload.data : payload;
  return data?.job && typeof data.job === 'object' ? data.job : data;
}

function outputUrl(payload) {
  const job = normalizedJob(payload);
  const outputs = job?.unsigned_urls || job?.output_urls || job?.video_urls || job?.outputs || job?.output || [];
  const candidate = job?.output_url || job?.video_url || job?.url || (Array.isArray(outputs) ? (typeof outputs[0] === 'string' ? outputs[0] : outputs[0]?.url) : outputs?.url) || null;
  try {
    const url = new URL(String(candidate || ''));
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch { return null; }
}

function updateFromProvider(jobId, payload) {
  const providerJob = normalizedJob(payload) || {};
  const rawStatus = String(providerJob.status || providerJob.state || (outputUrl(providerJob) ? 'completed' : 'processing')).toLowerCase();
  const normalizedStatus = rawStatus === 'succeeded' || rawStatus === 'success' ? 'completed' : rawStatus;
  const status = ALLOWED_STATUSES.has(normalizedStatus) ? normalizedStatus : 'processing';
  const terminal = TERMINAL_STATUSES.has(rawStatus);
  const pollingUrl = providerJob.polling_url || providerJob.status_url || providerJob.links?.status || null;
  updateVideoJob(jobId, {
    provider_job_id: providerJob.id || providerJob.job_id || providerJob.task_id ? String(providerJob.id || providerJob.job_id || providerJob.task_id) : null,
    status,
    polling_url: pollingUrl && isProviderUrl(pollingUrl) ? new URL(pollingUrl, apiBase()).toString() : null,
    output_url: outputUrl(providerJob),
    error: (providerJob.error || (providerJob.message && rawStatus === 'failed')) ? safeError(providerJob.error || providerJob.message) : null,
    completed_at: terminal ? new Date().toISOString() : null,
  });
  return getVideoJob(jobId);
}

export function hasNineRouterKey() {
  try { apiBase(); return true; } catch { return false; }
}

export async function listNineRouterVideoModels() {
  if (!hasNineRouterKey()) return [{ id: DEFAULT_VIDEO_MODEL, name: 'Google Veo', description: 'Model video default 9Router.' }];
  const payload = await request('models');
  const models = Array.isArray(payload.data) ? payload.data : [];
  const videoModels = models.filter((model) => /veo|video/i.test(`${model.id || ''} ${model.name || ''}`));
  return (videoModels.length ? videoModels : [{ id: DEFAULT_VIDEO_MODEL, name: 'Google Veo' }]).map((model) => ({
    id: String(model.id),
    name: String(model.name || model.id),
    description: String(model.description || ''),
  }));
}

export async function createNineRouterVideo({ model, prompt, duration, resolution, aspectRatio, generateAudio, source = 'web', telegramUserId = null, telegramChatId = null }) {
  if (generationRequestInFlight || activeVideoJobCount('9router') >= MAX_ACTIVE_VIDEO_JOBS) {
    throw new Error(`Batas ${MAX_ACTIVE_VIDEO_JOBS} job video aktif telah tercapai. Perbarui job yang ada terlebih dahulu.`);
  }
  generationRequestInFlight = true;
  const jobId = createVideoJob({ provider: '9router', model, prompt, duration, resolution, aspectRatio, generateAudio, source, telegramUserId, telegramChatId });
  try {
    const payload = await request(videoEndpoint(), {
      method: 'POST',
      body: JSON.stringify({ model, prompt, duration, resolution, aspect_ratio: aspectRatio, generate_audio: generateAudio }),
    });
    return updateFromProvider(jobId, payload);
  } catch (error) {
    const message = safeError(error);
    updateVideoJob(jobId, { status: 'failed', error: message, completed_at: new Date().toISOString() });
    throw new Error(message);
  } finally {
    generationRequestInFlight = false;
  }
}

export async function refreshNineRouterVideo(jobId) {
  const job = getVideoJob(jobId);
  if (!job) throw new Error('Job video tidak ditemukan.');
  if (job.provider !== '9router') throw new Error('Job ini dibuat melalui provider lain.');
  if (TERMINAL_STATUSES.has(job.status)) return job;
  const pollingUrl = job.polling_url || (job.provider_job_id ? providerUrl(`${videoEndpoint()}/${encodeURIComponent(job.provider_job_id)}`) : null);
  if (!pollingUrl || !isProviderUrl(pollingUrl)) throw new Error('URL status job tidak tersedia atau tidak valid.');
  try {
    return updateFromProvider(jobId, await request(new URL(pollingUrl, apiBase())));
  } catch (error) {
    const message = safeError(error);
    updateVideoJob(jobId, { error: message });
    throw new Error(message);
  }
}
