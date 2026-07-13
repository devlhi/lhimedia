import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import YTDlpModule from 'yt-dlp-wrap';
import { config } from './config.js';
import { createDownload, updateDownload } from './db.js';

const YTDlpWrap = YTDlpModule.default || YTDlpModule;
fs.mkdirSync(config.tempDir, { recursive: true });
const ytdlp = new YTDlpWrap(config.ytdlpBinary);

function validateDownloaderBinary() {
  let stat;
  try { stat = fs.lstatSync(config.ytdlpBinary); } catch { throw new Error('Binary yt-dlp belum terpasang. Jalankan ulang installer.'); }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Binary yt-dlp tidak aman.');
  if (process.platform !== 'win32' && (stat.mode & 0o022)) throw new Error('Permission binary yt-dlp terlalu longgar. Gunakan 0750 atau 0550.');
}

export async function ensureDownloader() {
  validateDownloaderBinary();
}

function cleanupTokenFiles(token) {
  for (const name of fs.readdirSync(config.tempDir)) {
    if (name.startsWith(token)) fs.rm(path.join(config.tempDir, name), { force: true }, () => {});
  }
}

export async function downloadMedia({ url, platform, source, userRef }) {
  const id = createDownload({ url, platform, source, userRef });
  const token = crypto.randomUUID();
  const output = path.join(config.tempDir, `${token}.%(ext)s`);
  updateDownload(id, { status: 'processing' });
  try {
    await ensureDownloader();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    let stdout = '';
    try {
      stdout = await ytdlp.execPromise([
        '--ignore-config', '--no-playlist', '--no-warnings', '--restrict-filenames',
        '--max-filesize', `${config.maxFileMb}M`, '-f', 'bv*[height<=1080]+ba/b[height<=1080]/b',
        '--merge-output-format', 'mp4', '--print', 'after_move:filepath', '-o', output, '--', url,
      ], { shell: false, maxBuffer: 1024 * 1024 }, controller.signal);
    } finally { clearTimeout(timer); }
    const printedPath = String(stdout || '').trim().split(/\r?\n/).filter(Boolean).at(-1);
    if (!printedPath) throw new Error('Media tidak tersedia atau melebihi batas ukuran.');
    const filePath = path.resolve(printedPath);
    const relative = path.relative(config.tempDir, filePath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Path hasil download tidak valid.');
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > config.maxFileMb * 1024 * 1024) throw new Error('File hasil tidak aman atau melebihi batas ukuran.');
    const file = path.basename(filePath);
    updateDownload(id, { status: 'completed', file_name: file, title: platform + ' media', completed_at: new Date().toISOString() });
    setTimeout(() => fs.rm(filePath, { force: true }, () => {}), config.cleanupMinutes * 60_000).unref();
    return { id, filePath, fileName: file };
  } catch (error) {
    cleanupTokenFiles(token);
    console.error(`Download #${id} gagal:`, error?.name || 'Error', String(error?.message || '').replace(/https?:\/\/\S+/gi, '[url]').slice(0, 240));
    updateDownload(id, { status: 'failed', error: 'Download gagal diproses.', completed_at: new Date().toISOString() });
    throw new Error('Media tidak dapat diunduh. Periksa URL, hak akses, dan batas ukuran.');
  }
}
