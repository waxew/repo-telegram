// Shared handler contexts keep request-owned state explicit and prevent global leakage.

// Import the repository abstraction used by every workflow.
import type { Database } from "../lib/database";
// Import the request-scoped Telegram client.
import type { TelegramClient } from "../lib/telegram";
// Import tenant and user rows already resolved by the webhook router.
import type { ConversationSessionRow, ShopBotRow, StoreUserRow } from "../types/domain";
// Import the exact incoming Telegram message shape.
import type { TelegramMessage } from "../types/telegram";

// StoreMessageContext is passed to customer and administrator message handlers.
export interface StoreMessageContext {
  // db performs tenant-scoped persistence.
  db: Database;
  // telegram calls the active customer bot only.
  telegram: TelegramClient;
  // shop is the tenant resolved from the unguessable webhook path.
  shop: ShopBotRow;
  // user is upserted before routing the update.
  user: StoreUserRow;
  // message is the private incoming update.
  message: TelegramMessage;
  // session is the optional persisted wizard state.
  session: ConversationSessionRow | null;
  // sessionKey is unique across shop and Telegram user.
  sessionKey: string;
  // isAdmin is computed from immutable owner id or configured second admin id.
  isAdmin: boolean;
  // publicBaseUrl builds hosted payment callback links without reading globals.
  publicBaseUrl: string;
}

// StoreCallbackContext extends the common fields with callback metadata.
export interface StoreCallbackContext extends Omit<StoreMessageContext, "message"> {
  // chatId is extracted from the callback's original message.
  chatId: number;
  // callbackData contains the compact inline action.
  callbackData: string;
}
