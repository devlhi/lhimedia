import crypto from 'node:crypto';

// Gunakan algoritma AES-256-GCM untuk keamanan data sensitif di database
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

export function encrypt(text, secretKey) {
  if (!text) return '';
  if (!secretKey) throw new Error('Kunci enkripsi tidak boleh kosong.');
  const key = crypto.scryptSync(secretKey, 'salt', 32);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decrypt(text, secretKey) {
  if (!text) return '';
  if (!secretKey) throw new Error('Kunci enkripsi tidak boleh kosong.');
  const parts = text.split(':');
  if (parts.length !== 3) return '';
  const [ivHex, authTagHex, encryptedText] = parts;
  const key = crypto.scryptSync(secretKey, 'salt', 32);
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
