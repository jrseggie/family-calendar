// A full copy of the database as SQL (tables + rows), for Setup > "Download a backup" and the monthly backup email.
// Restore into an empty database with: npx wrangler d1 execute <database> --remote --file <backup.sql>
// Left out: Cloudflare's own tables and the stored inbox mail (raw emails, deleted after 30 days anyway).
// 🔒 Info items stay scrambled in it (the key isn't in the database).
const SKIP = /^(sqlite_|d1_|_cf_)|^inbox_parts$/;

const sqlValue = (v) => {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (v instanceof ArrayBuffer || ArrayBuffer.isView(v) || Array.isArray(v)) {   // blobs
    const bytes = v instanceof ArrayBuffer ? new Uint8Array(v) : Array.isArray(v) ? Uint8Array.from(v) : new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    return `X'${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}'`;
  }
  return `'${String(v).replace(/'/g, "''")}'`;
};

export async function dumpDatabase(db, now = new Date()) {
  const tables = (await db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all()).results
    .filter((t) => !SKIP.test(t.name) && t.sql);
  const indexes = (await db.prepare("SELECT tbl_name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL").all()).results
    .filter((i) => !SKIP.test(i.tbl_name));
  const out = [`-- Family calendar backup, ${now.toISOString()}`, "PRAGMA foreign_keys = OFF;"];
  for (const t of tables) {
    out.push("", `${t.sql.replace(/^CREATE TABLE\s+/i, "CREATE TABLE IF NOT EXISTS ")};`);
    const rows = (await db.prepare(`SELECT * FROM "${t.name}"`).all()).results;
    for (const r of rows) {
      const cols = Object.keys(r);
      out.push(`INSERT INTO "${t.name}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map((c) => sqlValue(r[c])).join(", ")});`);
    }
  }
  for (const i of indexes) out.push(`${i.sql.replace(/^CREATE (UNIQUE )?INDEX\s+/i, (m, u) => `CREATE ${u || ""}INDEX IF NOT EXISTS `)};`);
  return out.join("\n") + "\n";
}

// gzip (the monthly email attaches calendar-backup-YYYY-MM-DD.sql.gz)
export async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
