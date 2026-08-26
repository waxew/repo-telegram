// A small fetch-based Telegram Bot API client supports dynamic customer tokens.

// Import domain media records for automatic delivery.
import type { AutomaticContent } from "../types/domain";
// Import only the Bot API types used by this wrapper.
import type {
  TelegramApiResponse,
  TelegramBotIdentity,
  TelegramChatMember,
  TelegramMessage,
  TelegramReplyMarkup,
} from "../types/telegram";

// TelegramApiError preserves a safe method-level failure description.
export class TelegramApiError extends Error {
  // Construct a normal Error with a readable name for logs and tests.
  constructor(message: string) {
    // Pass the controlled message to Error.
    super(message);
    // Name differentiates remote API errors from local programming errors.
    this.name = "TelegramApiError";
  }
}

// Payload values accepted by Telegram's JSON endpoints.
type TelegramPayloadValue = string | number | boolean | object | null | undefined;

// TelegramClient always belongs to one bot token and one incoming request scope.
export class TelegramClient {
  // Keep the token private so callers cannot accidentally log it.
  readonly #token: string;

  // Store the token without exposing a public property.
  constructor(token: string) {
    // A trimmed token avoids invisible copy-and-paste whitespace.
    this.#token = token.trim();
  }

  // Call a JSON Bot API method and validate Telegram's response envelope.
  async call<T>(method: string, payload: Record<string, TelegramPayloadValue> = {}): Promise<T> {
    // Build the official HTTPS endpoint for this bot and method.
    const url = `https://api.telegram.org/bot${this.#token}/${method}`;
    // Await work that is required for the caller's response correctness.
    const response = await fetch(url, {
      // Telegram accepts JSON POST requests for all methods used here.
      method: "POST",
      // Declare the UTF-8 JSON request body.
      headers: { "content-type": "application/json; charset=utf-8" },
      // Remove undefined fields before serialization.
      body: JSON.stringify(Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined))),
    });
    // Bot API JSON responses are bounded method envelopes, not arbitrary downloads.
    const envelope = (await response.json()) as TelegramApiResponse<T>;
    // Reject both non-2xx HTTP responses and ok:false API responses.
    if (!response.ok || !envelope.ok || envelope.result === undefined) {
      // Include method and Telegram's public description, never the token or payload.
      throw new TelegramApiError(`${method}: ${envelope.description ?? `HTTP ${response.status}`}`);
    }
    // Return the typed result after validation.
    return envelope.result;
  }

  // Validate a user-supplied token and read its public bot identity.
  async getMe(): Promise<TelegramBotIdentity> {
    // getMe requires no parameters.
    return this.call<TelegramBotIdentity>("getMe");
  }

  // Register an HTTPS webhook protected by Telegram's secret header.
  async setWebhook(url: string, secretToken: string): Promise<boolean> {
    // Restrict updates to message and callback types handled by this project.
    return this.call<boolean>("setWebhook", {
      url,
      secret_token: secretToken,
      allowed_updates: ["message", "callback_query", "my_chat_member"],
      drop_pending_updates: false,
    });
  }

  // Send a normal HTML-formatted text message.
  async sendMessage(chatId: number | string, text: string, replyMarkup?: TelegramReplyMarkup): Promise<TelegramMessage> {
    // parse_mode allows bold labels while link previews stay disabled for clean panels.
    return this.call<TelegramMessage>("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: replyMarkup,
    });
  }

  // Send a stored Telegram photo with optional caption and buttons.
  async sendPhoto(
    chatId: number | string,
    photo: string,
    caption?: string,
    replyMarkup?: TelegramReplyMarkup,
  ): Promise<TelegramMessage> {
    // Reusing a file_id avoids downloading and uploading tenant media.
    return this.call<TelegramMessage>("sendPhoto", {
      chat_id: chatId,
      photo,
      caption,
      parse_mode: "HTML",
      reply_markup: replyMarkup,
    });
  }

  // Send a previously uploaded document by its file_id.
  async sendDocument(chatId: number | string, document: string, caption?: string): Promise<TelegramMessage> {
    // The JSON endpoint is sufficient when document is a file_id.
    return this.call<TelegramMessage>("sendDocument", {
      chat_id: chatId,
      document,
      caption,
      parse_mode: "HTML",
    });
  }

  // Upload an in-memory backup file through multipart/form-data.
  async sendDocumentBytes(chatId: number | string, filename: string, contents: string, caption: string): Promise<TelegramMessage> {
    // FormData supplies Telegram's required multipart upload shape.
    const form = new FormData();
    // Convert numeric chat ids to text for multipart fields.
    form.set("chat_id", String(chatId));
    // Add the visible caption beside the backup.
    form.set("caption", caption);
    // Attach UTF-8 bytes with the requested filename.
    form.set("document", new Blob([contents], { type: "text/plain; charset=utf-8" }), filename);
    // Build the tokenized endpoint without including it in logs.
    const response = await fetch(`https://api.telegram.org/bot${this.#token}/sendDocument`, {
      // Telegram expects a POST upload.
      method: "POST",
      // The runtime adds the multipart boundary automatically.
      body: form,
    });
    // Parse Telegram's small response envelope.
    const envelope = (await response.json()) as TelegramApiResponse<TelegramMessage>;
    // Validate the upload result.
    if (!response.ok || !envelope.ok || !envelope.result) {
      throw new TelegramApiError(`sendDocument: ${envelope.description ?? `HTTP ${response.status}`}`);
    }
    // Return the sent message metadata.
    return envelope.result;
  }

  // Acknowledge every callback so Telegram removes its loading indicator.
  async answerCallbackQuery(callbackQueryId: string, text?: string, showAlert = false): Promise<boolean> {
    // A blank acknowledgement is valid when no toast is needed.
    return this.call<boolean>("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text,
      show_alert: showAlert,
    });
  }

  // Copy a message without retaining its original source header.
  async copyMessage(toChatId: number | string, fromChatId: number | string, messageId: number): Promise<{ message_id: number }> {
    // copyMessage works with text and all supported media types.
    return this.call<{ message_id: number }>("copyMessage", {
      chat_id: toChatId,
      from_chat_id: fromChatId,
      message_id: messageId,
    });
  }

  // Forward a message with Telegram's visible original-source attribution.
  async forwardMessage(toChatId: number | string, fromChatId: number | string, messageId: number): Promise<TelegramMessage> {
    // forwardMessage matches the panel's forwarding-broadcast option.
    return this.call<TelegramMessage>("forwardMessage", {
      chat_id: toChatId,
      from_chat_id: fromChatId,
      message_id: messageId,
    });
  }

  // Read one user's status in a required channel.
  async getChatMember(chatId: number | string, userId: number): Promise<TelegramChatMember> {
    // Telegram requires the bot to be able to inspect the configured chat.
    return this.call<TelegramChatMember>("getChatMember", { chat_id: chatId, user_id: userId });
  }

  // Resend one automatic-delivery item after a successful checkout.
  async sendAutomaticContent(chatId: number | string, content: AutomaticContent): Promise<void> {
    // Text content is delivered directly.
    if (content.kind === "text" && content.text) {
      await this.sendMessage(chatId, content.text);
      return;
    }
    // Every media branch requires a reusable Telegram file id.
    if (!content.file_id) return;
    // Photos use the dedicated photo method.
    if (content.kind === "photo") {
      await this.sendPhoto(chatId, content.file_id, content.caption);
      return;
    }
    // Documents use the dedicated document method.
    if (content.kind === "document") {
      await this.sendDocument(chatId, content.file_id, content.caption);
      return;
    }
    // Remaining media methods share the same simple payload shape.
    const methodByKind = {
      video: "sendVideo",
      audio: "sendAudio",
      voice: "sendVoice",
    } as const;
    // Select a method only for the supported remaining kinds.
    const method = methodByKind[content.kind as keyof typeof methodByKind];
    // An impossible or future kind is ignored instead of calling an arbitrary method.
    if (!method) return;
    // Telegram names the media parameter after its content type.
    await this.call<TelegramMessage>(method, {
      chat_id: chatId,
      [content.kind]: content.file_id,
      caption: content.caption,
    });
  }
}
