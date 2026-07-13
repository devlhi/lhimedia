import fs from 'node:fs';
import crypto from 'node:crypto';
import { recordSecurityEvent } from './db.js';
import { sanitizeSecurityEvent } from './security-monitor.js';

const MAX_BYTES = 256 * 1024;
const state = { position: 0, identity: '' };

function fileIdentity(stat) {
  return `${stat.dev}:${stat.ino}`;
}

export function importExternalSecurityEvents(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return 0;
  let stat;
  try { stat = fs.statSync(filePath); } catch { return 0; }
  const identity = fileIdentity(stat);
  if (state.identity !== identity || stat.size < state.position) state.position = 0;
  state.identity = identity;
  if (stat.size <= state.position) return 0;

  const previousPosition = state.position;
  const start = Math.max(previousPosition, stat.size - MAX_BYTES);
  let content;
  try {
    const length = stat.size - start;
    const descriptor = fs.openSync(filePath, 'r');
    try {
      const buffer = Buffer.alloc(length);
      fs.readSync(descriptor, buffer, 0, length, start);
      content = buffer.toString('utf8');
    } finally { fs.closeSync(descriptor); }
  } catch { return 0; }
  state.position = stat.size;

  const lines = content.split('\n');
  if (start > previousPosition && lines.length > 0) lines.shift();
  if (lines.length > 0 && lines[lines.length - 1] !== '') {
    const lastLineLength = Buffer.byteLength(lines.pop(), 'utf8');
    state.position = Math.max(start, state.position - lastLineLength);
  }
  let imported = 0;
  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length < 5) continue;
    const [timestamp, source, severity, category, ...summaryParts] = parts;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(timestamp || '')) continue;
    const summary = summaryParts.join(' ');
    const event = sanitizeSecurityEvent({ source, severity, category, summary });
    if (!event.summary) continue;

    // Deduplikasi tingkat lanjut: gunakan hash baris sebagai metadata untuk melacak event unik
    const fingerprint = crypto.createHash('sha256').update(line).digest('hex');
    recordSecurityEvent({ ...event, metadata: fingerprint, createdAt: timestamp });
    imported += 1;
  }
  return imported;
}
