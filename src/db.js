import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import session from 'express-session';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
const db = new DatabaseSync(config.dbPath);
db.exec(`PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS downloads (
 id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, platform TEXT NOT NULL,
 url TEXT NOT NULL, title TEXT, status TEXT NOT NULL DEFAULT 'queued',
 file_name TEXT, error TEXT, user_ref TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 completed_at TEXT
);
CREATE TABLE IF NOT EXISTS settings (
 key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS video_jobs (
 id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT NOT NULL DEFAULT '9router',
 provider_job_id TEXT, model TEXT NOT NULL, prompt TEXT NOT NULL, duration INTEGER NOT NULL,
 resolution TEXT NOT NULL, aspect_ratio TEXT NOT NULL, generate_audio INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'queued', polling_url TEXT, output_url TEXT, error TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
 sid TEXT PRIMARY KEY, data TEXT NOT NULL, expires_at INTEGER NOT NULL
)`);
const videoJobColumns = db.prepare('PRAGMA table_info(video_jobs)').all();
if (!videoJobColumns.some((column) => column.name === 'provider')) {
  db.exec("ALTER TABLE video_jobs ADD COLUMN provider TEXT NOT NULL DEFAULT '9router'");
}
if (!videoJobColumns.some((column) => column.name === 'source')) db.exec("ALTER TABLE video_jobs ADD COLUMN source TEXT NOT NULL DEFAULT 'web'");
if (!videoJobColumns.some((column) => column.name === 'telegram_user_id')) db.exec('ALTER TABLE video_jobs ADD COLUMN telegram_user_id TEXT');
if (!videoJobColumns.some((column) => column.name === 'telegram_chat_id')) db.exec('ALTER TABLE video_jobs ADD COLUMN telegram_chat_id TEXT');

export function createDownload({ source, platform, url, userRef = null }) {
  const result = db.prepare('INSERT INTO downloads (source, platform, url, user_ref) VALUES (?, ?, ?, ?)').run(source, platform, url, userRef);
  return Number(result.lastInsertRowid);
}
export function updateDownload(id, fields) {
  const allowed = ['title', 'status', 'file_name', 'error', 'completed_at'];
  const entries = Object.entries(fields).filter(([key]) => allowed.includes(key));
  if (!entries.length) return;
  db.prepare(`UPDATE downloads SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...entries.map(([,v]) => v), id);
}
export const getDownload = (id) => db.prepare('SELECT * FROM downloads WHERE id = ?').get(id);
export const recentDownloads = (limit = 30) => db.prepare('SELECT * FROM downloads ORDER BY id DESC LIMIT ?').all(limit);
export const stats = () => db.prepare(`SELECT COUNT(*) total, COALESCE(SUM(status='completed'), 0) completed,
  COALESCE(SUM(status='failed'), 0) failed, COALESCE(SUM(status IN ('queued','processing')), 0) active FROM downloads`).get();

export const getSetting = (key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value || '';
export const setSetting = (key, value) => db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`).run(key, value);

export function createVideoJob({ provider = '9router', model, prompt, duration, resolution, aspectRatio, generateAudio, source = 'web', telegramUserId = null, telegramChatId = null }) {
  const result = db.prepare(`INSERT INTO video_jobs (provider, model, prompt, duration, resolution, aspect_ratio, generate_audio, source, telegram_user_id, telegram_chat_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(provider, model, prompt, duration, resolution, aspectRatio, generateAudio ? 1 : 0, source, telegramUserId, telegramChatId);
  return Number(result.lastInsertRowid);
}
export function updateVideoJob(id, fields) {
  const allowed = ['provider_job_id', 'status', 'polling_url', 'output_url', 'error', 'completed_at'];
  const entries = Object.entries(fields).filter(([key]) => allowed.includes(key));
  if (!entries.length) return;
  db.prepare(`UPDATE video_jobs SET ${entries.map(([key]) => `${key} = ?`).join(', ')} WHERE id = ?`).run(...entries.map(([, value]) => value), id);
}
export const getVideoJob = (id) => db.prepare('SELECT * FROM video_jobs WHERE id = ?').get(id);
export const getTelegramVideoJob = (id, telegramUserId) => db.prepare("SELECT * FROM video_jobs WHERE id = ? AND source = 'telegram' AND telegram_user_id = ?").get(id, telegramUserId);
export const recentVideoJobs = (limit = 30) => db.prepare('SELECT * FROM video_jobs ORDER BY id DESC LIMIT ?').all(limit);
export const activeVideoJobCount = (provider) => Number(db.prepare(`SELECT COUNT(*) AS total FROM video_jobs
  WHERE provider = ? AND status NOT IN ('completed', 'failed', 'cancelled', 'expired')`).get(provider)?.total || 0);
export const activeTelegramVideoJobCount = (telegramUserId) => Number(db.prepare(`SELECT COUNT(*) AS total FROM video_jobs
  WHERE source = 'telegram' AND telegram_user_id = ? AND status NOT IN ('completed', 'failed', 'cancelled', 'expired')`).get(telegramUserId)?.total || 0);
export const telegramVideoJobCountToday = (telegramUserId) => Number(db.prepare(`SELECT COUNT(*) AS total FROM video_jobs
  WHERE source = 'telegram' AND telegram_user_id = ? AND created_at >= datetime('now', 'start of day')`).get(telegramUserId)?.total || 0);

export class SQLiteSessionStore extends session.Store {
  constructor() {
    super();
    this.cleanupTimer = setInterval(() => {
      try {
        db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
        db.prepare("DELETE FROM downloads WHERE created_at < datetime('now', '-30 days')").run();
        db.prepare("DELETE FROM video_jobs WHERE created_at < datetime('now', '-90 days')").run();
      } catch (error) { console.error('Pembersihan database gagal:', error?.message || 'error'); }
    }, 60 * 60_000);
    this.cleanupTimer.unref();
  }
  get(sid, callback) {
    try {
      const row = db.prepare('SELECT data FROM sessions WHERE sid = ? AND expires_at > ?').get(sid, Date.now());
      callback(null, row ? JSON.parse(row.data) : null);
    } catch (error) { callback(error); }
  }
  set(sid, value, callback = () => {}) {
    try {
      const expiresAt = value.cookie?.expires ? new Date(value.cookie.expires).getTime() : Date.now() + 8 * 60 * 60_000;
      db.prepare(`INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at`).run(sid, JSON.stringify(value), expiresAt);
      callback(null);
    } catch (error) { callback(error); }
  }
  destroy(sid, callback = () => {}) {
    try { db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid); callback(null); } catch (error) { callback(error); }
  }
}
