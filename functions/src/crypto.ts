import * as crypto from 'crypto';

/**
 * AES-256-GCM authenticated encryption.
 *
 * Key is loaded exclusively from the ENCRYPTION_SECRET_KEY environment
 * variable. If the variable is absent the process throws immediately —
 * there is no silent dev-fallback key.
 *
 * Stored format (colon-delimited hex):
 *   <iv:24 hex chars (12 bytes)>:<authTag:32 hex chars (16 bytes)>:<ciphertext hex>
 */

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_SECRET_KEY;
  if (!raw) {
    throw new Error(
      'ENCRYPTION_SECRET_KEY is not set. ' +
      'Set it via Firebase Secrets before deploying: ' +
      'firebase functions:secrets:set ENCRYPTION_SECRET_KEY'
    );
  }
  // Accept the key as-is if it is already 32 bytes (hex or raw).
  // We derive a fixed-length key via SHA-256 so any string length works.
  return crypto.createHash('sha256').update(raw).digest();
}

export function encrypt(text: string): string {
  if (!text) return '';
  const key = getKey();
  // Fresh 12-byte IV on every call — GCM standard nonce length
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag(); // 16-byte integrity tag
  // Store as: iv(hex) : authTag(hex) : ciphertext(hex)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(text: string): string {
  if (!text) return '';
  const key = getKey();
  const parts = text.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid ciphertext format: expected iv:authTag:ciphertext');
  }
  const [ivHex, authTagHex, ciphertextHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  // If the ciphertext or authTag has been tampered with, final() throws —
  // we let that propagate so the caller can handle it explicitly.
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}
