// Cryptography tests verify round trips, tamper detection, and secret comparisons.

// Import Vitest primitives.
import { describe, expect, it } from "vitest";
// Import the Web Crypto helpers used for stored customer bot tokens.
import {
  constantTimeEqual,
  decryptSecret,
  encryptSecret,
  generateWebhookSecret,
  looksLikeTelegramBotToken,
  sha256Hex,
} from "../src/lib/crypto";

// Group security-helper behavior.
describe("crypto helpers", () => {
  // AES-GCM must recover the original value only with the same key/IV.
  it("encrypts and decrypts a token", async () => {
    const key = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, index) => index)));
    const encrypted = await encryptSecret("123456789:abcdefghijklmnopqrstuvwxyzABCDE", key);
    await expect(decryptSecret(encrypted.ciphertext, encrypted.iv, key)).resolves.toBe(
      "123456789:abcdefghijklmnopqrstuvwxyzABCDE",
    );
  });

  // A changed authenticated ciphertext must be rejected.
  it("detects ciphertext tampering", async () => {
    const key = btoa("01234567890123456789012345678901");
    const encrypted = await encryptSecret("secret", key);
    const replacement = encrypted.ciphertext.endsWith("A") ? "B" : "A";
    const tampered = `${encrypted.ciphertext.slice(0, -1)}${replacement}`;
    await expect(decryptSecret(tampered, encrypted.iv, key)).rejects.toThrow();
  });

  // Hash/compare utilities should distinguish equal and unequal values.
  it("hashes and compares webhook secrets", async () => {
    expect(await sha256Hex("abc")).toHaveLength(64);
    expect(constantTimeEqual("same", "same")).toBe(true);
    expect(constantTimeEqual("same", "different")).toBe(false);
    expect(generateWebhookSecret()).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  });

  // Structural token validation filters obvious user input mistakes.
  it("validates BotFather token shape", () => {
    expect(looksLikeTelegramBotToken("123456789:abcdefghijklmnopqrstuvwxyzABCDE")).toBe(true);
    expect(looksLikeTelegramBotToken("not-a-token")).toBe(false);
  });
});
