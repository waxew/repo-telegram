// Small pure helpers keep validation and Persian presentation consistent.

// Import the message and delivery shapes used by media extraction.
import type { AutomaticContent } from "../types/domain";
import type { TelegramMessage } from "../types/telegram";

// Convert Persian and Arabic-Indic digits to ASCII before numeric validation.
export function normalizeDigits(value: string): string {
  // Persian digits occupy this ordered string.
  const persianDigits = "۰۱۲۳۴۵۶۷۸۹";
  // Arabic-Indic digits occupy this ordered string.
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";

  // Replace both digit families while preserving every other character.
  return [...value]
    .map((character) => {
      // Look for the character in the Persian set.
      const persianIndex = persianDigits.indexOf(character);
      // Convert a found Persian digit to its ASCII index.
      if (persianIndex >= 0) return String(persianIndex);
      // Look for the character in the Arabic-Indic set.
      const arabicIndex = arabicDigits.indexOf(character);
      // Convert a found Arabic-Indic digit to its ASCII index.
      if (arabicIndex >= 0) return String(arabicIndex);
      // Preserve normal text, punctuation, and ASCII digits.
      return character;
    })
    // Join the transformed characters back into one string.
    .join("");
}

// Parse a positive whole number and reject formatted or fractional input.
export function parsePositiveInteger(value: string): number | null {
  // Normalize non-ASCII digits and remove common thousands separators.
  const normalized = normalizeDigits(value).replace(/[,_٬،\s]/g, "");
  // Only a non-zero decimal integer is accepted.
  if (!/^[1-9]\d*$/.test(normalized)) return null;
  // Convert the validated decimal string to a JavaScript number.
  const parsed = Number(normalized);
  // Database bigint values used by this app must stay exactly representable.
  if (!Number.isSafeInteger(parsed)) return null;
  // Return the safe positive integer.
  return parsed;
}

// Format wallet and price values in the same Toman style as the video.
export function formatToman(amount: number): string {
  // en-US produces stable comma separators while the suffix remains Persian.
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(amount)} تومان`;
}

// Format a timestamp with the Persian calendar and Tehran time zone.
export function formatPersianDateTime(value: string | Date = new Date()): string {
  // Normalize string input into a Date instance.
  const date = value instanceof Date ? value : new Date(value);
  // Intl handles leap years and Jalali conversion more safely than handwritten math.
  return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

// Escape untrusted Telegram names before placing them in HTML-formatted messages.
export function escapeHtml(value: string): string {
  // Replace ampersand first so later entity markers are not double-escaped.
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

// Generate a short, deterministic referral code from a Telegram user id.
export function referralCodeFor(telegramUserId: number): string {
  // Base-36 keeps the code compact and contains URL-safe characters only.
  return `r${telegramUserId.toString(36)}`;
}

// Create the builder-bot session key used as the database primary key.
export function builderSessionKey(telegramUserId: number): string {
  // The namespace prevents collision with tenant-store sessions.
  return `builder:${telegramUserId}`;
}

// Create a tenant-scoped session key for a storefront conversation.
export function storeSessionKey(shopId: string, telegramUserId: number): string {
  // Including shopId isolates the same Telegram user across different stores.
  return `store:${shopId}:${telegramUserId}`;
}

// Select the largest photo variant Telegram included in an update.
export function largestPhotoFileId(message: TelegramMessage): string | null {
  // Missing photos cannot produce a reusable file id.
  if (!message.photo || message.photo.length === 0) return null;
  // Compare pixel areas to find the clearest available size.
  const largest = [...message.photo].sort((left, right) => right.width * right.height - left.width * left.height)[0];
  // The preceding length check guarantees a first item.
  return largest?.file_id ?? null;
}

// Convert a Telegram message into one automatic-delivery content item.
export function extractAutomaticContent(message: TelegramMessage): AutomaticContent | null {
  // Plain text is delivered with sendMessage.
  if (message.text) return { kind: "text", text: message.text };
  // Photos use the largest reusable file_id.
  const photoFileId = largestPhotoFileId(message);
  // Preserve the photo caption if it exists.
  if (photoFileId) return { kind: "photo", file_id: photoFileId, caption: message.caption };
  // Documents preserve both caption and original filename.
  if (message.document) {
    return {
      kind: "document",
      file_id: message.document.file_id,
      caption: message.caption,
      file_name: message.document.file_name,
    };
  }
  // Videos are resent by file_id after purchase.
  if (message.video) return { kind: "video", file_id: message.video.file_id, caption: message.caption };
  // Audio files use sendAudio.
  if (message.audio) return { kind: "audio", file_id: message.audio.file_id, caption: message.caption };
  // Voice notes use sendVoice.
  if (message.voice) return { kind: "voice", file_id: message.voice.file_id, caption: message.caption };
  // Unsupported stickers, locations, and contacts are not stored as product files.
  return null;
}

// Normalize an @username or numeric id before sending it to Telegram.
export function normalizeChatReference(value: string): string | null {
  // Remove surrounding whitespace introduced by copy and paste.
  const trimmed = normalizeDigits(value).trim();
  // Telegram usernames contain letters, digits, and underscores.
  if (/^@[A-Za-z0-9_]{5,32}$/.test(trimmed)) return trimmed;
  // Channel and group identifiers can be negative signed integers.
  if (/^-?\d{5,20}$/.test(trimmed)) return trimmed;
  // Reject arbitrary URLs and malformed usernames.
  return null;
}

// Convert a channel reference into a public URL when possible.
export function channelUrl(chatId: string): string | null {
  // Public usernames can be opened through t.me.
  if (chatId.startsWith("@")) return `https://t.me/${chatId.slice(1)}`;
  // Private numeric channels have no reliable public URL.
  return null;
}

// Return a short error message without accidentally serializing secrets.
export function safeErrorMessage(error: unknown): string {
  // Standard Error instances provide a controlled message field.
  if (error instanceof Error) return error.message.slice(0, 500);
  // Unknown thrown values become a generic diagnostic label.
  return "Unknown error";
}
