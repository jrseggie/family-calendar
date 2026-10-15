-- 💡 Requests: ideas and bug reports from anyone with a login. Each one is also sent to the Family Calendar maker (lib/requests.js),
-- who decides what's built for everyone; the maker's status / reply comes back on the daily sync (maker_status, maker_note).
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'idea', title TEXT NOT NULL, details TEXT, page TEXT, device TEXT,
  screenshot BLOB, screenshot_type TEXT, created_by TEXT, created_at TEXT NOT NULL,
  sent_at TEXT, maker_id INTEGER, maker_status TEXT, maker_note TEXT, maker_at TEXT);
CREATE TABLE IF NOT EXISTS request_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, request_id INTEGER NOT NULL, by TEXT, at TEXT NOT NULL, text TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS request_comments_req ON request_comments(request_id);
