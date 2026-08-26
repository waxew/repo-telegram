// Backup tests verify escaping, tenant metadata, JSON, and idempotent inserts.

// Import Vitest primitives.
import { describe, expect, it } from "vitest";
// Import the pure SQL serializer.
import { createSqlBackup } from "../src/lib/backup";

// Group SQL backup behavior.
describe("createSqlBackup", () => {
  // Serialize representative text, JSON, booleans, numbers, and null values.
  it("creates a restorable idempotent SQL script", () => {
    const sql = createSqlBackup("shop-1", {
      telegram_shop_products: [{
        id: "p1",
        name_fa: "محصول علی's",
        is_active: true,
        category_id: null,
        image_file_ids: ["file-1"],
        public_code: 10,
      }],
    });
    expect(sql).toContain("BEGIN;");
    expect(sql).toContain("OVERRIDING SYSTEM VALUE");
    expect(sql).toContain("علی''s");
    expect(sql).toContain("'[\"file-1\"]'::jsonb");
    expect(sql).toContain("ON CONFLICT DO NOTHING;");
    expect(sql).toContain("COMMIT;");
  });
});
