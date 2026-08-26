// Web Crypto helpers protect bot tokens and webhook secrets at rest and in transit.

// Convert a Uint8Array to standard Base64 without Node-only Buffer APIs.
function bytesToBase64(bytes: Uint8Array): string {
  // Build the binary string in chunks to avoid call-stack limits.
  let binary = "";
  // Append each byte as one binary character.
  for (const byte of bytes) binary += String.fromCharCode(byte);
  // btoa is available in both Cloudflare Workers and modern Node test runtimes.
  return btoa(binary);
}

// Convert standard Base64 back into bytes.
function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  // atob validates and decodes the Base64 string.
  const binary = atob(value);
  // Allocate the exact output length.
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  // Copy every decoded character code into the typed array.
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  // Return bytes suitable for Web Crypto.
  return bytes;
}

// Import the deployment secret as a non-exportable AES-GCM key.
async function importEncryptionKey(base64Key: string): Promise<CryptoKey> {
  // Decode the environment value.
  const rawKey = base64ToBytes(base64Key);
  // AES-256 requires exactly 32 bytes.
  if (rawKey.byteLength !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes");
  // Import the key for encryption and decryption only.
  return crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

// Encrypt a customer bot token before inserting it into Supabase.
export async function encryptSecret(plaintext: string, base64Key: string): Promise<{ ciphertext: string; iv: string }> {
  // Import the environment-owned encryption key.
  const key = await importEncryptionKey(base64Key);
  // Generate a fresh 96-bit IV, the recommended AES-GCM size.
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  // Convert the token text to UTF-8 bytes.
  const encoded = new TextEncoder().encode(plaintext);
  // AES-GCM authenticates the ciphertext and detects later tampering.
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  // Store ciphertext and IV separately as portable Base64 strings.
  return { ciphertext: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}

// Decrypt a bot token only for the request that needs to call Telegram.
export async function decryptSecret(ciphertext: string, iv: string, base64Key: string): Promise<string> {
  // Import the same AES key used during setup.
  const key = await importEncryptionKey(base64Key);
  // Decode the per-token IV.
  const decodedIv = base64ToBytes(iv);
  // Decode the authenticated ciphertext.
  const decodedCiphertext = base64ToBytes(ciphertext);
  // A changed key, IV, or ciphertext causes this operation to throw.
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decodedIv }, key, decodedCiphertext);
  // Convert the verified UTF-8 bytes back to the Telegram token.
  return new TextDecoder().decode(decrypted);
}

// Return a lowercase SHA-256 hex digest for webhook-secret storage.
export async function sha256Hex(value: string): Promise<string> {
  // Encode text in a deterministic cross-platform form.
  const encoded = new TextEncoder().encode(value);
  // Hash without retaining the original secret.
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoded));
  // Convert every byte to a two-character hexadecimal pair.
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Compare two secret strings without an early-return timing leak.
export function constantTimeEqual(left: string, right: string): boolean {
  // Encode both values into bytes.
  const leftBytes = new TextEncoder().encode(left);
  // Encode the comparison value with the same algorithm.
  const rightBytes = new TextEncoder().encode(right);
  // Start with the length difference so unequal lengths can never pass.
  let difference = leftBytes.length ^ rightBytes.length;
  // Iterate over the longest input instead of returning at the first mismatch.
  const length = Math.max(leftBytes.length, rightBytes.length);
  // Accumulate all byte differences in one value.
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  // Only a zero accumulator means the values matched exactly.
  return difference === 0;
}

// Generate a Telegram-compatible webhook secret using cryptographic randomness.
export function generateWebhookSecret(): string {
  // Generate 32 random bytes to provide 256 bits of entropy.
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  // Base64url avoids characters disallowed by Telegram's secret_token field.
  return bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

// Validate the broad structural format of a BotFather token before making a request.
export function looksLikeTelegramBotToken(value: string): boolean {
  // Current tokens contain a numeric bot id, a colon, and a long URL-safe secret.
  return /^\d{6,15}:[A-Za-z0-9_-]{20,}$/.test(value.trim());
}
