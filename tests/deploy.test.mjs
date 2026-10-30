// lib/deploy.js: a whole install and an update against a pretend Cloudflare account (no network)
import { test } from "node:test";
import assert from "node:assert/strict";
import { installCalendar, deployScript, migrate, statements } from "../lib/deploy.js";

const manifest = {
  version: "9.9.9", compatibility_date: "2025-09-01", crons: ["*/10 * * * *"], main: "worker.js", headers: "/*\n  Cache-Control: no-cache\n",
  assets: { "/index.html": { hash: "a".repeat(32), size: 5, type: "text/html" }, "/app.js": { hash: "b".repeat(32), size: 3, type: "application/javascript" } },
  migrations: [{ name: "0000_start.sql", sql: "-- tables\nCREATE TABLE settings (\n  key TEXT PRIMARY KEY,\n  value TEXT\n);\nCREATE TABLE people (id INTEGER);\n" },
               { name: "0001_more.sql", sql: "ALTER TABLE people ADD COLUMN name TEXT;" }],
};
const file = async (name) => new Response(name === "manifest.json" ? JSON.stringify(manifest) : `content of ${name}`);

// a fake account: records every call, answers like Cloudflare does
function fakeCloudflare({ scripts = [], subdomain = null } = {}) {
  const calls = [], sql = [];
  const cf = async (method, path, body, opts = {}) => {
    calls.push({ method, path, body, auth: opts.auth });
    if (path === "/accounts") return [{ id: "acc1" }];
    if (path.endsWith("/workers/scripts") && method === "GET") return scripts.map((id) => ({ id }));
    if (path.endsWith("/workers/subdomain")) {
      if (method === "GET") { if (!subdomain) throw new Error("no subdomain"); return { subdomain }; }
      subdomain = body.subdomain; return { subdomain };
    }
    if (path.includes("/d1/database?name=")) return [];
    if (path.endsWith("/d1/database") && method === "POST") return { uuid: "db1" };
    if (path.endsWith("/query")) { sql.push(body.sql); return [{ results: /SELECT name FROM d1_migrations/.test(body.sql) ? [] : [] }]; }
    if (path.endsWith("/assets-upload-session")) return { jwt: "upload-jwt", buckets: [["a".repeat(32)]] };
    if (path.includes("/workers/assets/upload")) return { result: { jwt: "done-jwt" } };
    return {};
  };
  return { cf, calls, sql };
}

test("statements: comments dropped, multi-line statements kept whole", () => {
  assert.deepEqual(statements(manifest.migrations[0].sql), ["CREATE TABLE settings (\n  key TEXT PRIMARY KEY,\n  value TEXT\n)", "CREATE TABLE people (id INTEGER)"]);
});

test("migrate: only the ones the database hasn't had, each noted in d1_migrations", async () => {
  const ran = [];
  const run = async (s, p = []) => { ran.push([s, p]); return /SELECT name/.test(s) ? [{ name: "0000_start.sql" }] : []; };
  assert.deepEqual(await migrate(manifest, run), ["0001_more.sql"]);
  assert.ok(ran.some(([s]) => s.startsWith("ALTER TABLE people")));
  assert.ok(!ran.some(([s]) => s.startsWith("CREATE TABLE people")));
  assert.deepEqual(ran.at(-1), ["INSERT INTO d1_migrations (name) VALUES (?)", ["0001_more.sql"]]);
});

test("install: database, tables, files, code, address, keys - into a free name", async () => {
  const f = fakeCloudflare({ scripts: ["family-calendar"] });   // a calendar is already there: never touched
  const r = await installCalendar(f.cf, file, { name: "Smith", token: "t".repeat(40) });
  assert.equal(r.script, "family-calendar-2");
  assert.equal(r.url, "https://family-calendar-2.smith.workers.dev");
  assert.match(r.code, /^[0-9a-f]{36}$/);
  const put = f.calls.find((c) => c.method === "PUT" && c.path === "/accounts/acc1/workers/scripts/family-calendar-2");
  const meta = JSON.parse(await put.body.get("metadata").text());
  assert.deepEqual(meta.bindings.map((b) => b.type), ["assets", "d1", "send_email"]);
  assert.equal(meta.bindings[1].id, "db1");
  assert.equal(meta.assets.jwt, "done-jwt");
  assert.ok(meta.keep_bindings.includes("secret_text"));
  assert.equal(f.calls.find((c) => c.path.includes("/workers/assets/upload")).auth, "upload-jwt");
  assert.ok(!f.calls.some((c) => c.path.startsWith("/accounts/acc1/workers/scripts/family-calendar/")), "the existing calendar is left alone");
  const secrets = f.calls.filter((c) => c.path.endsWith("/secrets")).map((c) => c.body.name);
  assert.deepEqual(secrets, ["SETUP_CODE", "CF_API_TOKEN", "CF_ACCOUNT_ID"]);
  assert.ok(f.sql.some((s) => /CREATE TABLE people/.test(s)) && f.sql.some((s) => /deploy_mode|INSERT INTO settings/.test(s)));
});

test("install again after a stop half-way: carries on with the same calendar", async () => {
  const f = fakeCloudflare({ scripts: ["family-calendar", "family-calendar-2"], subdomain: "smith" });
  const r = await installCalendar(f.cf, file, { name: "Smith", token: "t".repeat(40), script: "family-calendar-2" });
  assert.equal(r.script, "family-calendar-2");
});

test("update: same bindings, secrets kept, schedule set", async () => {
  const f = fakeCloudflare();
  await deployScript(f.cf, file, { acc: "acc1", script: "family-calendar", d1Id: "db1", manifest });
  const meta = JSON.parse(await f.calls.find((c) => c.method === "PUT" && c.path.endsWith("/family-calendar")).body.get("metadata").text());
  assert.deepEqual(meta.keep_bindings, ["secret_text", "secret_key", "plain_text"]);
  assert.deepEqual(f.calls.find((c) => c.path.endsWith("/schedules")).body, [{ cron: "*/10 * * * *" }]);
});
