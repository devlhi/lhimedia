import { platforms } from './platforms.js';

const form = document.querySelector('[data-download-form]');
const input = document.querySelector('#media-url');
const pasteButton = document.querySelector('[data-paste-button]');
const platformStatus = document.querySelector('[data-platform-status]');
const submitButton = form?.querySelector('button[type="submit"]');
const buttonLabel = submitButton?.querySelector('[data-button-label]');
const defaultButtonLabel = buttonLabel?.textContent || 'Ambil media';
let resetTimer = null;

function detectPlatform(value) {
  let url;
  try { url = new URL(String(value).trim()); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  for (const [domain, name] of platforms) {
    if (host === domain || host.endsWith(`.${domain}`)) return name;
  }
  return null;
}

function updatePlatformStatus() {
  if (!input || !platformStatus) return;
  const value = input.value.trim();
  const platform = detectPlatform(value);
  platformStatus.classList.toggle('is-visible', Boolean(value));
  platformStatus.classList.toggle('is-supported', Boolean(platform));
  platformStatus.classList.toggle('is-unsupported', Boolean(value && !platform));
  platformStatus.textContent = !value ? '' : platform
    ? `✓ Tautan ${platform} terdeteksi. Validasi keamanan tetap dilakukan saat dikirim.`
    : 'Platform belum dikenali. Gunakan Facebook, Instagram, TikTok, YouTube, atau X.';
}

function setBusy(busy) {
  if (!form || !submitButton) return;
  form.setAttribute('aria-busy', String(busy));
  form.classList.toggle('is-busy', busy);
  submitButton.disabled = busy;
  if (buttonLabel) buttonLabel.textContent = busy ? 'Memproses…' : defaultButtonLabel;
  if (!busy && resetTimer) clearTimeout(resetTimer);
  resetTimer = busy ? setTimeout(() => setBusy(false), 5 * 60_000) : null;
}

if (input) {
  input.addEventListener('input', updatePlatformStatus);
  input.addEventListener('paste', () => setTimeout(updatePlatformStatus));
  updatePlatformStatus();
}

if (pasteButton) {
  if (!navigator.clipboard?.readText || !window.isSecureContext) pasteButton.hidden = true;
  pasteButton.addEventListener('click', async () => {
    if (!input) return;
    try {
      const text = (await navigator.clipboard.readText()).trim().slice(0, input.maxLength || 2048);
      if (!text) throw new Error('empty');
      input.value = text;
      updatePlatformStatus();
      input.focus();
    } catch {
      input.focus();
      if (platformStatus) {
        platformStatus.classList.add('is-visible', 'is-unsupported');
        platformStatus.classList.remove('is-supported');
        platformStatus.textContent = 'Clipboard tidak dapat dibaca. Tempel tautan secara manual.';
      }
    }
  });
}

form?.addEventListener('submit', (event) => {
  if (form.getAttribute('aria-busy') === 'true') {
    event.preventDefault();
    return;
  }
  setBusy(true);
});

window.addEventListener('pageshow', () => setBusy(false));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && form?.getAttribute('aria-busy') === 'true') {
    setTimeout(() => setBusy(false), 1200);
  }
});
