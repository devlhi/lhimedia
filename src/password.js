import crypto from 'node:crypto';

const KEY_LENGTH = 64;

export function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12) {
    throw new Error('Password admin minimal 12 karakter.');
  }
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEY_LENGTH);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password, encodedHash) {
  try {
    const [algorithm, saltHex, expectedHex] = String(encodedHash).split(':');
    if (algorithm !== 'scrypt' || !/^[a-f0-9]{32}$/i.test(saltHex) || !/^[a-f0-9]{128}$/i.test(expectedHex)) return false;
    const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), KEY_LENGTH);
    const expected = Buffer.from(expectedHex, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
