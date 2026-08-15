// src/network/Crypto.ts

// The Web Crypto API uses AES-GCM for authenticated encryption.
// We derive a cryptographic key from a user-provided string passphrase
// using PBKDF2 with a fixed salt (since we want all nodes with the same
// password to independently arrive at the same AES key without handshake).

const SALT = new TextEncoder().encode('MESH_OS_TACTICAL_SALT');
const ITERATIONS = 100000;
const IV_LENGTH = 12;

/**
 * Derives an AES-GCM CryptoKey from a plaintext password.
 */
async function deriveKey(password: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: SALT,
      iterations: ITERATIONS,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts a Uint8Array payload using AES-GCM.
 * Prepend the 12-byte IV to the returned ciphertext.
 */
export async function encryptPayload(data: Uint8Array, keyStr: string): Promise<Uint8Array> {
  const key = await deriveKey(keyStr);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    data as BufferSource
  );
  
  const cipherArray = new Uint8Array(cipherBuffer);
  const result = new Uint8Array(iv.length + cipherArray.length);
  result.set(iv, 0);
  result.set(cipherArray, iv.length);
  
  return result;
}

/**
 * Decrypts an AES-GCM payload. Expects the first 12 bytes to be the IV.
 * Throws an error if decryption fails (e.g. wrong key or corrupted data).
 */
export async function decryptPayload(data: Uint8Array, keyStr: string): Promise<Uint8Array> {
  if (data.length < IV_LENGTH) {
    throw new Error('Payload too short to contain IV');
  }
  
  const key = await deriveKey(keyStr);
  const iv = data.slice(0, IV_LENGTH);
  const ciphertext = data.slice(IV_LENGTH);
  
  const plainBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext as BufferSource
  );
  
  return new Uint8Array(plainBuffer);
}
