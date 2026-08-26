// Unit tests lock down Persian input normalization and safe presentation helpers.

// Import Vitest's test and assertion functions.
import { describe, expect, it } from "vitest";
// Import the pure helpers under test.
import {
  channelUrl,
  escapeHtml,
  formatToman,
  normalizeChatReference,
  normalizeDigits,
  parsePositiveInteger,
} from "../src/lib/format";

// Group all input/presentation cases in one readable suite.
describe("format helpers", () => {
  // Persian and Arabic-Indic digits must become ASCII before validation.
  it("normalizes Persian and Arabic digits", () => {
    expect(normalizeDigits("۱۲۳-٤٥٦")).toBe("123-456");
  });

  // Whole positive amounts accept separators but reject zero/fractions/text.
  it("parses safe positive integer amounts", () => {
    expect(parsePositiveInteger("۱,۲۵۰")).toBe(1250);
    expect(parsePositiveInteger("0")).toBeNull();
    expect(parsePositiveInteger("12.5")).toBeNull();
    expect(parsePositiveInteger("نامعتبر")).toBeNull();
  });

  // Toman output uses predictable grouping and suffix.
  it("formats Toman amounts", () => {
    expect(formatToman(1250000)).toBe("1,250,000 تومان");
  });

  // Owner/customer text cannot break Telegram HTML mode.
  it("escapes Telegram HTML", () => {
    expect(escapeHtml(`<Ali & "Sara">`)).toBe("&lt;Ali &amp; &quot;Sara&quot;&gt;");
  });

  // Only supported chat references are accepted.
  it("validates chat references and public URLs", () => {
    expect(normalizeChatReference(" @valid_channel ")).toBe("@valid_channel");
    expect(normalizeChatReference("-1001234567890")).toBe("-1001234567890");
    expect(normalizeChatReference("https://evil.example")).toBeNull();
    expect(channelUrl("@valid_channel")).toBe("https://t.me/valid_channel");
    expect(channelUrl("-1001234567890")).toBeNull();
  });
});
