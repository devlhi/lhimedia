import { config } from './config.js';

let active = 0;
const queue = [];
const activeUsers = new Set();

function normalizeUserKey(source, userRef) {
  const value = String(userRef || '').trim();
  return value ? `${source}:${value.slice(0, 160)}` : '';
}

function pump() {
  while (active < config.downloadConcurrency && queue.length) {
    const nextIndex = queue.findIndex((job) => !job.userKey || !activeUsers.has(job.userKey));
    if (nextIndex < 0) return;
    const job = queue.splice(nextIndex, 1)[0];
    active += 1;
    if (job.userKey) activeUsers.add(job.userKey);
    void job.run()
      .then(job.resolve, job.reject)
      .finally(() => {
        active -= 1;
        if (job.userKey) activeUsers.delete(job.userKey);
        pump();
      });
  }
}

export function runDownloadJob({ source, userRef }, run) {
  if (typeof run !== 'function') return Promise.reject(new Error('Job download tidak valid.'));
  const userKey = normalizeUserKey(source, userRef);
  if (userKey && activeUsers.has(userKey)) return Promise.reject(new Error('Masih ada download aktif untuk pengguna ini.'));
  if (queue.some((job) => job.userKey === userKey)) return Promise.reject(new Error('Permintaan download pengguna ini sedang dalam antrean.'));
  if (queue.length >= config.downloadQueueLimit) return Promise.reject(new Error('Antrean download sedang penuh. Coba lagi beberapa saat.'));
  return new Promise((resolve, reject) => {
    queue.push({ userKey, run, resolve, reject });
    pump();
  });
}

export function getDownloadQueueStatus() {
  return { active, queued: queue.length, capacity: config.downloadConcurrency, queueLimit: config.downloadQueueLimit };
}
