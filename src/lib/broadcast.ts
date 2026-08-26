// Cron-driven broadcast delivery keeps mass messaging outside webhook latency.

// Import the database queue and tenant repository.
import type { Database } from "./database";
// Decrypt each tenant token only while processing its own broadcast.
import { decryptSecret } from "./crypto";
// Use the dynamic customer-bot client for delivery.
import { TelegramClient } from "./telegram";
// Convert unknown failures to bounded, secret-safe text.
import { safeErrorMessage } from "./format";

// Process at most one bounded batch during a scheduled Worker invocation.
export async function processNextBroadcast(db: Database, encryptionKey: string): Promise<void> {
  // Read the oldest queued/running job.
  const job = await db.getNextBroadcast();
  // An empty queue requires no further work.
  if (!job) return;
  // Resolve the owning tenant record.
  const shop = await db.getShopById(job.shop_id);
  // A deleted tenant turns the queued job into a controlled failure.
  if (!shop) {
    await db.updateBroadcast(job.id, { status: "failed", last_error: "Shop not found" });
    return;
  }
  // Decrypt the bot token within this scheduled request only.
  const token = await decryptSecret(shop.token_ciphertext, shop.token_iv, encryptionKey);
  // Create the request-scoped Telegram client.
  const telegram = new TelegramClient(token);
  // Mark a new job as running before its first send.
  if (job.status === "queued") await db.updateBroadcast(job.id, { status: "running" });
  // Read a bounded chronological recipient batch.
  const users = await db.listBroadcastBatch(job.shop_id, job.cursor_created_at, 25);
  // No remaining recipients completes the job.
  if (users.length === 0) {
    await db.updateBroadcast(job.id, { status: "completed", last_error: null });
    return;
  }
  // Carry cumulative counters across cron invocations.
  let sentCount = job.sent_count;
  // Carry the cumulative failure count as well.
  let failedCount = job.failed_count;
  // Retain only the latest safe error for owner diagnostics.
  let lastError: string | null = null;
  // Deliver sequentially to avoid a sudden Telegram API burst.
  for (const user of users) {
    try {
      // Copy mode hides the source header; forward mode preserves it.
      if (job.mode === "copy") {
        await telegram.copyMessage(user.telegram_user_id, job.source_chat_id, job.source_message_id);
      } else {
        await telegram.forwardMessage(user.telegram_user_id, job.source_chat_id, job.source_message_id);
      }
      // Count each successful recipient.
      sentCount += 1;
    } catch (error) {
      // Blocked/deleted chats are expected and do not stop other recipients.
      failedCount += 1;
      // Store a bounded message that never contains the token.
      lastError = safeErrorMessage(error);
    }
  }
  // The last row timestamp becomes the next batch cursor.
  const cursor = users.at(-1)?.created_at ?? job.cursor_created_at;
  // A short batch proves there are no more rows after this cursor.
  const completed = users.length < 25;
  // Persist all progress in one update.
  await db.updateBroadcast(job.id, {
    cursor_created_at: cursor,
    sent_count: sentCount,
    failed_count: failedCount,
    last_error: lastError,
    status: completed ? "completed" : "running",
  });
}
