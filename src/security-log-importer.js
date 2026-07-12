import fs from 'node:fs';
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

  const start = Math.max(state.position, stat.size - MAX_BYTES);
  let content;
  try {
    const length = stat.size - start;
    const descriptor = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(length);
    fs.readSync(descriptor, buffer, 0, length, start);
    fs.closeSync(descriptor);
    content = buffer.toString('utf8');
  } catch { return 0; }
  state.position = stat.size;

  const lines = content.split('\n');
  if (start > 0) lines.shift();
  let imported = 0;
  for (const line of lines) {
    const [timestamp, source, severity, category, ...summaryParts] = line.split('\t');
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(timestamp || '')) continue;
    const event = sanitizeSecurityEvent({ source, severity, category, summary: summaryParts.join(' ') });
    if (!event.summary) continue;
    recordSecurityEvent(event);
    imported += 1;
  }
  return imported;
}
