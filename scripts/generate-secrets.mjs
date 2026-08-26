// Generate deployment secrets locally without external dependencies.

// Import Node's cryptographically secure random-byte source.
import { randomBytes } from "node:crypto";

// Telegram webhook secrets allow URL-safe Base64 characters.
const webhookSecret = randomBytes(32).toString("base64url");
// AES-256 expects exactly 32 raw bytes encoded here as standard Base64.
const encryptionKey = randomBytes(32).toString("base64");

// Print copyable variable assignments; run this only in a private terminal.
console.log(`BUILDER_WEBHOOK_SECRET=${webhookSecret}`);
// Print the independent token encryption key on its own line.
console.log(`TOKEN_ENCRYPTION_KEY=${encryptionKey}`);
