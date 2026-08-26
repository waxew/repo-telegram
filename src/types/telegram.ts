// This file contains only the Telegram fields that this project actually reads.

// Telegram represents user and chat identifiers as integers safe in JavaScript's range.
export interface TelegramUser {
  // id is stable and is the only safe account identifier.
  id: number;
  // is_bot distinguishes administrators from bot accounts.
  is_bot: boolean;
  // first_name always exists in Telegram updates.
  first_name: string;
  // last_name can be absent.
  last_name?: string;
  // username can be changed by the user and is therefore display-only.
  username?: string;
}

// A chat supplies the destination id for every outgoing message.
export interface TelegramChat {
  // id can be a private user, group, supergroup, or channel id.
  id: number;
  // type lets support flows reject unsupported public-chat inputs.
  type: "private" | "group" | "supergroup" | "channel";
}

// Telegram sends multiple sizes for one uploaded photo.
export interface TelegramPhotoSize {
  // file_id can be reused by the same bot without downloading the image.
  file_id: string;
  // width helps us select the largest available variant.
  width: number;
  // height completes the size comparison.
  height: number;
  // file_size is optional in Telegram updates.
  file_size?: number;
}

// Documents and videos share the reusable file_id behavior.
export interface TelegramFileAttachment {
  // file_id is the value stored for later automatic delivery.
  file_id: string;
  // file_name is shown in backup and automatic-delivery metadata.
  file_name?: string;
  // mime_type helps preserve intent when a file is resent.
  mime_type?: string;
}

// Message contains the union of text and supported media used by the wizards.
export interface TelegramMessage {
  // message_id uniquely identifies the message inside its chat.
  message_id: number;
  // from is absent for some channel-originated messages.
  from?: TelegramUser;
  // chat identifies where the bot should reply.
  chat: TelegramChat;
  // date is a Unix timestamp supplied by Telegram.
  date: number;
  // text holds commands and normal button values.
  text?: string;
  // caption accompanies photos, videos, and documents.
  caption?: string;
  // photo contains increasing image sizes.
  photo?: TelegramPhotoSize[];
  // document represents arbitrary product delivery files and receipts.
  document?: TelegramFileAttachment;
  // video represents a Telegram video file.
  video?: TelegramFileAttachment;
  // audio represents a Telegram audio file.
  audio?: TelegramFileAttachment;
  // voice represents a Telegram voice note.
  voice?: TelegramFileAttachment;
  // reply_to_message enables support replies sent by an administrator.
  reply_to_message?: TelegramMessage;
}

// Callback queries are produced by inline buttons attached to a message.
export interface TelegramCallbackQuery {
  // id must be acknowledged with answerCallbackQuery.
  id: string;
  // from is the person who pressed the button.
  from: TelegramUser;
  // message is present for callback buttons sent by this bot.
  message?: TelegramMessage;
  // data carries a compact action identifier of at most 64 bytes.
  data?: string;
}

// Telegram sends one Update object per webhook request.
export interface TelegramUpdate {
  // update_id makes retry deduplication possible if it is added later.
  update_id: number;
  // message carries commands, text, and uploads.
  message?: TelegramMessage;
  // callback_query carries inline button actions.
  callback_query?: TelegramCallbackQuery;
}

// Telegram currently supports three explicit colored button styles.
export type TelegramButtonStyle = "danger" | "success" | "primary";

// Reply keyboard buttons send their text back as a normal message.
export interface ReplyKeyboardButton {
  // text is both the visible label and incoming message value.
  text: string;
  // style requests Telegram's red, green, or blue visual treatment.
  style?: TelegramButtonStyle;
}

// ReplyKeyboardMarkup stays visible below the chat like the reference video.
export interface ReplyKeyboardMarkup {
  // keyboard is an ordered list of button rows.
  keyboard: Array<Array<string | ReplyKeyboardButton>>;
  // resize_keyboard asks clients to use compact button heights.
  resize_keyboard: true;
  // is_persistent keeps the main menu available after a tap.
  is_persistent?: boolean;
  // input_field_placeholder explains the expected next input.
  input_field_placeholder?: string;
}

// Inline buttons trigger callbacks without adding button text to chat history.
export interface InlineKeyboardButton {
  // text is the visible label.
  text: string;
  // callback_data identifies a server-side action.
  callback_data?: string;
  // url opens a channel, product link, or external payment page.
  url?: string;
  // copy_text copies values such as tracking codes or card numbers.
  copy_text?: { text: string };
  // style mirrors the green, blue, and red buttons shown in the video.
  style?: TelegramButtonStyle;
}

// InlineKeyboardMarkup is attached directly to a message or media card.
export interface InlineKeyboardMarkup {
  // inline_keyboard is an ordered list of callback or URL button rows.
  inline_keyboard: InlineKeyboardButton[][];
}

// Reply markup accepted by the helper functions in this project.
export type TelegramReplyMarkup = ReplyKeyboardMarkup | InlineKeyboardMarkup;

// Telegram API wraps every method result in this standard envelope.
export interface TelegramApiResponse<T> {
  // ok indicates whether Telegram accepted the request.
  ok: boolean;
  // result exists after successful requests.
  result?: T;
  // description explains a failed request without exposing local secrets.
  description?: string;
  // error_code is useful for retry and validation decisions.
  error_code?: number;
}

// getMe returns the public identity of a customer-created bot.
export interface TelegramBotIdentity extends TelegramUser {
  // username is required for every Telegram bot.
  username: string;
}

// getChatMember returns the membership status needed for forced-join checks.
export interface TelegramChatMember {
  // status describes whether the user is present in the configured channel.
  status: "creator" | "administrator" | "member" | "restricted" | "left" | "kicked";
  // user is the membership subject.
  user: TelegramUser;
  // is_member clarifies restricted members that still belong to a chat.
  is_member?: boolean;
}
