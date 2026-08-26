// SQL backup helpers serialize one tenant without exposing unrelated project data.

// Import the JSON-safe repository output shape.
import type { JsonValue } from "../types/domain";

// Quote a PostgreSQL identifier after validating its conservative character set.
function quoteIdentifier(value: string): string {
  // Only project-controlled snake_case names are permitted.
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error("Unsafe SQL identifier");
  // Double quotes preserve exact names and avoid keyword collisions.
  return `"${value}"`;
}

// Convert a JSON-compatible value into a PostgreSQL literal.
function sqlLiteral(value: JsonValue): string {
  // SQL NULL represents a JSON null at the row level.
  if (value === null) return "NULL";
  // Numbers were validated by PostgreSQL before export.
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  // Boolean keywords do not require quotes.
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  // Arrays and objects belong to json/jsonb columns in this schema.
  if (Array.isArray(value) || typeof value === "object") {
    // Escape single quotes before casting the serialized text to jsonb.
    return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
  }
  // Escape every plain text value using PostgreSQL's doubled-quote convention.
  return `'${value.replaceAll("'", "''")}'`;
}

// Convert repository table rows to an ordered, readable SQL restore script.
export function createSqlBackup(shopId: string, tables: Record<string, JsonValue[]>): string {
  // Begin with instructions and a transaction boundary.
  const statements = [
    "-- Telegram Shop Builder tenant backup",
    `-- Shop id: ${shopId}`,
    `-- Created at: ${new Date().toISOString()}`,
    "-- Restore into a database that already has supabase/schema.sql applied.",
    "BEGIN;",
  ];
  // Preserve insertion order supplied by the repository.
  for (const [table, rawRows] of Object.entries(tables)) {
    // Emit one section marker per table even when it is empty.
    statements.push("", `-- ${table}`);
    // Serialize each object row independently for simple debugging and recovery.
    for (const rawRow of rawRows) {
      // Database rows must be JSON objects, not primitives or arrays.
      if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) continue;
      // Object.entries preserves the database response's column order.
      const entries = Object.entries(rawRow);
      // Skip an impossible empty row.
      if (entries.length === 0) continue;
      // Quote all controlled column names.
      const columns = entries.map(([column]) => quoteIdentifier(column)).join(", ");
      // Convert each JSON-safe cell to a PostgreSQL literal.
      const values = entries.map(([, value]) => sqlLiteral(value)).join(", ");
      // Identity columns require OVERRIDING SYSTEM VALUE during a faithful restore.
      const identityOverride = table === "telegram_shop_products" ? " OVERRIDING SYSTEM VALUE" : "";
      // ON CONFLICT makes re-running a backup non-destructive.
      statements.push(`INSERT INTO public.${quoteIdentifier(table)} (${columns})${identityOverride} VALUES (${values}) ON CONFLICT DO NOTHING;`);
    }
  }
  // Finish the restore transaction and add a trailing newline.
  statements.push("", "COMMIT;", "");
  // Join statements into the downloadable UTF-8 SQL file.
  return statements.join("\n");
}
