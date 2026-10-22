import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { getJwtSecret } from '../config.js';

/**
 * Encryption at rest for secrets stored in the database (e.g. the customer's Anthropic key).
 * AES-256-GCM; the key is derived (HKDF) from SETTINGS_ENCRYPTION_KEY, or from JWT_SECRET
 * when that is not set. Changing the secret makes stored values unreadable: they are
 * treated as "not configured" and have to be entered again.
 */
function encryptionKey(): Buffer {
  const raw = process.env.SETTINGS_ENCRYPTION_KEY || getJwtSecret();
  return Buffer.from(hkdfSync('sha256', raw, 'newcrm-settings-v1', 'aes-256-gcm', 32));
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), data].map((p) => (typeof p === 'string' ? p : p.toString('base64'))).join(':');
}

/** Returns null when the blob is malformed or was encrypted with a different secret. */
export function decryptSecret(blob: string): string | null {
  try {
    const [version, iv, tag, data] = blob.split(':');
    if (version !== 'v1' || !iv || !tag || !data) return null;
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
