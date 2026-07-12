export const DEFAULT_VIDEO_MODEL = 'google/veo-3.1-lite';
export const VIDEO_DURATIONS = Object.freeze([4, 6, 8]);
export const VIDEO_RESOLUTIONS = Object.freeze(['720p', '1080p']);
export const VIDEO_ASPECT_RATIOS = Object.freeze(['16:9', '9:16']);

export function validateVideoParameters({ model, prompt, duration, resolution, aspectRatio, generateAudio }, allowedModelIds) {
  const normalized = {
    model: String(model || '').trim(),
    prompt: String(prompt || '').trim(),
    duration: Number(duration),
    resolution: String(resolution || ''),
    aspectRatio: String(aspectRatio || ''),
    generateAudio: Boolean(generateAudio),
  };
  const models = new Set(Array.from(allowedModelIds || [], String));
  if (normalized.prompt.length < 10 || normalized.prompt.length > 2000) throw new Error('Prompt harus berisi 10–2000 karakter.');
  if (!models.has(normalized.model)) throw new Error('Model video tidak valid atau tidak tersedia.');
  if (!VIDEO_DURATIONS.includes(normalized.duration) || !VIDEO_RESOLUTIONS.includes(normalized.resolution) || !VIDEO_ASPECT_RATIOS.includes(normalized.aspectRatio)) {
    throw new Error('Parameter video tidak valid.');
  }
  return normalized;
}

export function parseTelegramVeoCommand(payload) {
  const input = String(payload || '').trim();
  const result = { model: DEFAULT_VIDEO_MODEL, duration: 8, resolution: '1080p', aspectRatio: '16:9', generateAudio: false };
  const seen = new Set();
  let rest = input;
  while (rest.startsWith('--')) {
    const match = rest.match(/^--([a-z-]+)=([^\s]+)(?:\s+|$)/i);
    if (!match) throw new Error('Opsi /veo tidak valid. Gunakan format --opsi=nilai.');
    const key = match[1].toLowerCase();
    const value = match[2];
    if (seen.has(key)) throw new Error(`Opsi --${key} tidak boleh diulang.`);
    seen.add(key);
    if (key === 'model') {
      if (!/^[A-Za-z0-9._/-]{1,120}$/.test(value)) throw new Error('Model video tidak valid.');
      result.model = value;
    } else if (key === 'duration') result.duration = Number(value);
    else if (key === 'resolution') result.resolution = value;
    else if (key === 'ratio') result.aspectRatio = value;
    else if (key === 'audio' && ['true', 'false'].includes(value)) result.generateAudio = value === 'true';
    else throw new Error(`Opsi --${key} tidak didukung.`);
    rest = rest.slice(match[0].length).trimStart();
  }
  result.prompt = rest.trim();
  return result;
}
