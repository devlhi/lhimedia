import crypto from 'node:crypto';

const MAX_PATH_LENGTH = 180;
const SUSPICIOUS_PATH = /(?:^|\/)(?:\.env|\.git|wp-admin|wp-login\.php|xmlrpc\.php|phpmyadmin|adminer|vendor\/phpunit|cgi-bin)(?:\/|$)|(?:\.\.|%2e|%00|etc\/passwd|proc\/self|eval-stdin\.php)/i;
const SUSPICIOUS_AGENT = /(?:sqlmap|nikto|nmap|masscan|acunetix|nessus|dirbuster|gobuster|wpscan|zgrab)/i;

function cleanPath(value) {
  const raw = String(value || '/').split('?')[0].replace(/[\r\n\t]/g, '');
  return raw.slice(0, MAX_PATH_LENGTH) || '/';
}

export function normalizeRoutePath(value, telegramWebhookPath = '') {
  const path = cleanPath(value);
  if (telegramWebhookPath && path === telegramWebhookPath) return '/telegram/webhook/[redacted]';
  return path.replace(/\/telegram\/webhook\/[A-Za-z0-9_-]{12,}/g, '/telegram/webhook/[redacted]');
}

export function pseudonymizeAddress(value, secret) {
  const address = String(value || 'unknown').slice(0, 100);
  return crypto.createHmac('sha256', secret).update(address).digest('hex').slice(0, 16);
}

export function classifySuspiciousRequest({ path, method, statusCode, userAgent = '', isAdmin = false }) {
  const normalizedPath = cleanPath(path);
  const normalizedMethod = String(method || 'GET').toUpperCase().slice(0, 10);
  if (SUSPICIOUS_PATH.test(normalizedPath)) {
    return { category: 'scanner_path', severity: 'high', summary: `Path pemindaian terdeteksi (${normalizedMethod})` };
  }
  if (SUSPICIOUS_AGENT.test(String(userAgent).slice(0, 300))) {
    return { category: 'scanner_agent', severity: 'high', summary: `User-Agent alat pemindai terdeteksi (${normalizedMethod})` };
  }
  if (isAdmin && Number(statusCode) === 401) {
    return { category: 'admin_auth', severity: 'medium', summary: 'Akses atau login admin ditolak' };
  }
  if (isAdmin && Number(statusCode) === 403) {
    return { category: 'admin_csrf', severity: 'high', summary: 'Permintaan admin ditolak oleh pemeriksaan CSRF' };
  }
  return null;
}

export function sanitizeSecurityEvent({ source = 'application', category, severity = 'low', summary, actorHash = '', path = '', metadata = '' }) {
  const validSources = new Set(['application', 'nginx', 'fail2ban', 'ssh']);
  const validSeverities = new Set(['low', 'medium', 'high', 'critical']);
  return {
    source: validSources.has(source) ? source : 'application',
    category: String(category || 'unknown').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'unknown',
    severity: validSeverities.has(severity) ? severity : 'low',
    summary: String(summary || 'Aktivitas terdeteksi').replace(/[\r\n\t]/g, ' ').slice(0, 240),
    actorHash: String(actorHash || '').replace(/[^a-f0-9]/gi, '').slice(0, 32),
    path: cleanPath(path),
    metadata: String(metadata || '').replace(/[\r\n\t]/g, ' ').slice(0, 240),
  };
}
