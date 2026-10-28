import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { SessionData } from 'express-session';

const FORMAT_VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + NONCE_BYTES + TAG_BYTES;
const MAX_PAYLOAD_BYTES = 1_048_576;

export class SessionPayloadCipher {
  private readonly key: Buffer;

  constructor(encodedKey: string) {
    const key = Buffer.from(encodedKey, 'base64');
    if (key.length !== 32 || key.toString('base64') !== encodedKey) {
      throw new Error('SESSION_ENCRYPTION_KEY debe ser base64 de 32 bytes.');
    }
    this.key = key;
  }

  encrypt(sidHash: string, session: SessionData): Buffer {
    const plaintext = Buffer.from(JSON.stringify(session), 'utf8');
    if (plaintext.length + HEADER_BYTES > MAX_PAYLOAD_BYTES) {
      throw new Error('La carga de sesión excede el límite permitido.');
    }
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(this.additionalData(sidHash));
    const ciphertext = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);
    return Buffer.concat([
      Buffer.from([FORMAT_VERSION]),
      nonce,
      cipher.getAuthTag(),
      ciphertext,
    ]);
  }

  decrypt(sidHash: string, payload: Buffer): SessionData {
    try {
      if (
        payload.length <= HEADER_BYTES ||
        payload.length > MAX_PAYLOAD_BYTES ||
        payload[0] !== FORMAT_VERSION
      ) {
        throw new Error();
      }
      const nonce = payload.subarray(1, 1 + NONCE_BYTES);
      const tag = payload.subarray(1 + NONCE_BYTES, HEADER_BYTES);
      const decipher = createDecipheriv('aes-256-gcm', this.key, nonce);
      decipher.setAAD(this.additionalData(sidHash));
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([
        decipher.update(payload.subarray(HEADER_BYTES)),
        decipher.final(),
      ]);
      const data: unknown = JSON.parse(plaintext.toString('utf8'));
      if (
        !isRecord(data) ||
        !Object.hasOwn(data, 'cookie') ||
        !isRecord(data.cookie)
      ) {
        throw new Error();
      }
      return data as unknown as SessionData;
    } catch {
      throw new Error('La carga cifrada de sesión no es válida.');
    }
  }

  private additionalData(sidHash: string): Buffer {
    if (!/^[a-f0-9]{64}$/.test(sidHash)) {
      throw new Error('El identificador de sesión no es válido.');
    }
    return Buffer.from(`kvg.session.v${FORMAT_VERSION}:${sidHash}`, 'utf8');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
