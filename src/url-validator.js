import dns from 'node:dns/promises';
import net from 'node:net';
import { platforms } from '../public/js/platforms.js';

function isPrivateIp(ip) {
  const family = net.isIP(ip);
  if (!family) return false;
  if (family === 4) return /^(0\.|10\.|127\.|169\.254\.|192\.168\.)/.test(ip)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(ip) || /^22[4-9]\.|^23\d\.|^24\d\.|^25[0-5]\./.test(ip);
  const normalized = ip.toLowerCase();
  if (normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || /^fe[89ab]/.test(normalized) || normalized.startsWith('ff')) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mapped ? isPrivateIp(mapped) : false;
}

export async function validateMediaUrl(input) {
  let url;
  try { url = new URL(String(input).trim()); } catch { throw new Error('URL tidak valid.'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Hanya URL HTTP/HTTPS yang diizinkan.');
  if (url.username || url.password || url.port) throw new Error('URL mengandung bagian yang tidak diizinkan.');
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'localhost' || isPrivateIp(host)) throw new Error('Alamat lokal tidak diizinkan.');
  const match = [...platforms].find(([domain]) => host === domain || host.endsWith(`.${domain}`));
  if (!match) throw new Error('Platform belum didukung. Gunakan Facebook, Instagram, TikTok, YouTube, atau X.');
  let records;
  try { records = await dns.lookup(url.hostname, { all: true }); }
  catch { throw new Error('Alamat tujuan tidak dapat diverifikasi.'); }
  if (!records.length || records.some(({ address }) => isPrivateIp(address))) throw new Error('Alamat tujuan tidak aman.');
  return { url: url.toString(), platform: match[1] };
}
