// UI tests protect the reference video's most important menu hierarchy and colors.

// Import Vitest primitives.
import { describe, expect, it } from "vitest";
// Import visible copy and native Telegram keyboard builders.
import { BUTTONS } from "../src/ui/texts";
import { adminMainKeyboard, builderMainKeyboard, financeKeyboard, shopMainKeyboard } from "../src/ui/keyboards";
// Import a complete settings type for the finance snapshot.
import type { ShopSettings } from "../src/types/domain";

// Group the stable menu contract.
describe("Telegram native UI", () => {
  // Central builder must expose the same five entry points as the recording.
  it("keeps the builder menu hierarchy", () => {
    expect(builderMainKeyboard.keyboard.flat().map((button) => typeof button === "string" ? button : button.text)).toEqual([
      BUTTONS.buildStore,
      BUTTONS.renew,
      BUTTONS.myBots,
      BUTTONS.builderSupport,
      BUTTONS.builderAccount,
    ]);
  });

  // Storefront and admin entry points must remain visible.
  it("keeps customer and admin menus", () => {
    const shopLabels = shopMainKeyboard.keyboard.flat().map((button) => typeof button === "string" ? button : button.text);
    const adminLabels = adminMainKeyboard.keyboard.flat().map((button) => typeof button === "string" ? button : button.text);
    expect(shopLabels).toContain(BUTTONS.products);
    expect(shopLabels).toContain(BUTTONS.adminPanel);
    expect(adminLabels).toContain(BUTTONS.productManagement);
    expect(adminLabels).toContain(BUTTONS.backup);
  });

  // Finance switches must render their current visual state.
  it("renders enabled/disabled finance labels", () => {
    const settings: ShopSettings = {
      start_text: "start",
      start_photo_file_id: null,
      support_username: null,
      support_chat_id: null,
      log_channel_id: null,
      satisfaction_channel_id: null,
      force_channels: [],
      second_admin_id: null,
      referral_reward: 20000,
      payment: {
        card_enabled: true,
        card_holder: null,
        card_number: null,
        zarinpal_enabled: false,
        zarinpal_merchant_id: null,
      },
    };
    const labels = financeKeyboard(settings).keyboard.flat().map((button) => typeof button === "string" ? button : button.text);
    expect(labels).toContain("کارت: روشن ✅");
    expect(labels).toContain("زرین پال: خاموش ❌");
  });
});
